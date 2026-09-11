/* eslint-disable @typescript-eslint/no-explicit-any -- repair plans and snapshots contain heterogeneous JSON values */
import fs from 'node:fs';
import path from 'node:path';
import { PERMISSION_FIELDS, PRIVILEGED_ROLES, assertStaticConfiguration } from './config';
import { canonicalJson, isBlank, normalizeEmail, readJson, readJsonLines, sha256, writeJson } from './common';

interface SnapshotRow {
  id: string;
  updateTime?: string;
  data: Record<string, any>;
}

interface RepairWrite {
  phase: number;
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  deleteFields?: string[];
  precondition: { exists: false } | { updateTime: string };
}

function normalizeRole(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function roleManifest(users: Array<{ id: string; data: Record<string, any> }>): string {
  const rows = users
    .filter(row => PRIVILEGED_ROLES.has(normalizeRole(row.data.role)) || PERMISSION_FIELDS.some(field => row.data[field] === true))
    .map(row => ({
      id: row.id,
      email: normalizeEmail(row.data.email),
      role: row.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map(field => [field, row.data[field] === true])),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalJson(rows));
}

function main(): void {
  assertStaticConfiguration();
  const runDir = path.resolve(process.argv[2] ?? 'docs/migration-analysis/runs/20260910T174452Z/repair-dry-run');
  const summary = readJson<any>(path.join(runDir, 'repair-dry-run-summary.json'));
  const decisions = readJson<any>(path.join(runDir, 'repair-decisions.json'));
  const manifest = readJson<any>(path.join(runDir, 'firestore/manifest.json'));
  const writes = readJsonLines(path.join(runDir, 'proposed-repair-writes.jsonl')) as RepairWrite[];
  const errors: string[] = [];

  if (summary.status !== 'APPROVAL_READY_FOR_REHEARSAL') errors.push(`Unexpected plan status: ${summary.status}`);
  if (summary.validation?.passed !== true) errors.push('Planner invariant validation did not pass');
  if (summary.operatorReviewRows !== 0) errors.push(`Operator review rows remain: ${summary.operatorReviewRows}`);
  if (summary.writes !== writes.length) errors.push(`Write count mismatch: ${summary.writes} != ${writes.length}`);
  const planHash = sha256(writes.map(canonicalJson).join('\n'));
  if (summary.planHash !== planHash) errors.push(`Plan hash mismatch: ${summary.planHash} != ${planHash}`);
  const decisionChecksum = sha256(canonicalJson(decisions));
  if (summary.approvedDecisionArtifact?.checksum !== decisionChecksum) errors.push('Approved decision checksum mismatch');
  const operatorCsv = fs.readFileSync(path.join(runDir, 'operator-decisions.csv'), 'utf8').trim().split(/\r?\n/);
  if (operatorCsv.length !== 1) errors.push(`operator-decisions.csv contains ${operatorCsv.length - 1} unresolved rows`);

  const current = new Map<string, SnapshotRow>();
  for (const table of manifest.tables ?? []) {
    for (const row of readJsonLines(path.join(runDir, 'firestore', table.file)) as SnapshotRow[]) {
      current.set(`${table.collection}|${row.id}`, row);
    }
  }
  const simulated = new Map<string, Record<string, any>>([...current].map(([key, row]) => [key, structuredClone(row.data)]));
  const allowedExistingUserFields = new Set(['segment', 'guide', 'residency', 'residencyApproved']);
  const allowedGuideDeletes = new Set(['abbreviation', 'phone', 'id', 'migrationProvenance']);
  const seenTargets = new Set<string>();

  for (const write of writes) {
    const key = `${write.collection}|${write.documentId}`;
    if (seenTargets.has(key)) errors.push(`Multiple writes target one document: ${key}`);
    seenTargets.add(key);
    if (/^LLP/i.test(write.collection) || write.collection === 'PushSubscriptions') errors.push(`Forbidden collection: ${write.collection}`);
    if (write.operation === 'create') {
      if (current.has(key)) errors.push(`Create target already exists: ${key}`);
      if (!('exists' in write.precondition) || write.precondition.exists !== false) errors.push(`Create precondition invalid: ${key}`);
    } else {
      const captured = current.get(key);
      if (!captured?.updateTime || !('updateTime' in write.precondition) || captured.updateTime !== write.precondition.updateTime) {
        errors.push(`Update-time precondition invalid: ${key}`);
      }
    }
    if (write.collection === 'Users' && write.operation === 'update') {
      for (const field of [...Object.keys(write.data), ...(write.deleteFields ?? [])]) {
        if (!allowedExistingUserFields.has(field)) errors.push(`Forbidden existing User field: ${key}.${field}`);
      }
      if ('segment' in write.data && (write.data.segment !== 'FOLK' || !isBlank(current.get(key)?.data.segment))) {
        errors.push(`Unsafe segment repair: ${key}`);
      }
    }
    for (const field of write.deleteFields ?? []) {
      if (write.collection !== 'Guides' || !allowedGuideDeletes.has(field)) errors.push(`Forbidden field deletion: ${key}.${field}`);
    }
    const data = write.operation === 'create' ? {} : structuredClone(simulated.get(key) ?? {});
    Object.assign(data, write.data);
    for (const field of write.deleteFields ?? []) delete data[field];
    simulated.set(key, data);
  }

  for (const [sourceUserId, decision] of Object.entries<any>(decisions.postWatermarkUsers ?? {})) {
    const created = writes.find(write => write.operation === 'create' && write.collection === 'Users' && write.documentId === sourceUserId);
    if (!created) {
      errors.push(`Approved User create missing: ${sourceUserId}`);
      continue;
    }
    if (normalizeEmail(created.data.email) !== normalizeEmail(decision.email) || created.data.userId !== decision.assignedUserId) {
      errors.push(`Approved User identity mismatch: ${sourceUserId}`);
    }
    if (created.data.role !== 'User' || created.data.segment !== 'FOLK') errors.push(`Approved User classification mismatch: ${sourceUserId}`);
    if (PERMISSION_FIELDS.some(field => created.data[field] !== false)) errors.push(`Approved User permission mismatch: ${sourceUserId}`);
    if (['uid', 'authUid', 'firebaseUid', 'firebaseAuthUid'].some(field => !isBlank(created.data[field]))) {
      errors.push(`Approved User includes Auth identifier: ${sourceUserId}`);
    }
  }

  const beforeUsers = [...current].filter(([key]) => key.startsWith('Users|')).map(([, row]) => ({ id: row.id, data: row.data }));
  const afterUsers = [...simulated].filter(([key]) => key.startsWith('Users|')).map(([key, data]) => ({ id: key.slice(6), data }));
  const roleManifestBefore = roleManifest(beforeUsers);
  const roleManifestAfter = roleManifest(afterUsers);
  if (roleManifestBefore !== roleManifestAfter) errors.push('Privileged role/flag manifest changes in simulation');

  for (const [collection, field, normalize] of [
    ['Users', 'email', normalizeEmail],
    ['Users', 'userId', (value: unknown) => String(value ?? '').trim().toLowerCase()],
    ['Guides', 'email', normalizeEmail],
    ['Guides', 'guideId', (value: unknown) => String(value ?? '').trim().toLowerCase()],
  ] as const) {
    const counts = new Map<string, number>();
    for (const [key, data] of simulated) {
      if (!key.startsWith(`${collection}|`)) continue;
      const value = normalize(data[field]);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [value, count] of counts) if (count > 1) errors.push(`Duplicate ${collection}.${field}: ${value}`);
  }

  const verification = {
    kind: 'functional-migration-repair-verification',
    repairRunId: summary.repairRunId,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    planHash,
    decisionChecksum,
    writes: writes.length,
    approvalReadyForRehearsal: errors.length === 0,
    roleManifestBefore,
    roleManifestAfter,
    roleManifestUnchanged: roleManifestBefore === roleManifestAfter,
    errors,
  };
  writeJson(path.join(runDir, 'repair-verification.json'), verification);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (errors.length > 0) throw new Error(`Functional repair verification failed with ${errors.length} error(s)`);
}

main();
