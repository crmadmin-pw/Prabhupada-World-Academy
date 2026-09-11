/* eslint-disable @typescript-eslint/no-explicit-any -- repair plans and Firestore REST payloads are heterogeneous */
import fs from 'node:fs';
import path from 'node:path';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, PERMISSION_FIELDS, PRIVILEGED_ROLES, assertStaticConfiguration } from './config';
import { canonicalJson, normalizeEmail, readJson, readJsonLines, sha256, writeJson } from './common';
import { documentName, encodeFields, fieldPath, firebaseAccessToken, listCollection } from './firestoreRest';

interface RepairWrite {
  phase: number;
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  deleteFields?: string[];
  precondition: { exists: false } | { updateTime: string };
}

const MAX_WRITES_PER_COMMIT = 500;
const MAX_COMMIT_BODY_BYTES = 8_000_000;

function roleManifest(rows: any[]): string {
  const manifest = rows
    .filter(row => PRIVILEGED_ROLES.has(String(row.data.role ?? '').trim().toLowerCase()) || PERMISSION_FIELDS.some(field => row.data[field] === true))
    .map(row => ({
      id: row.id,
      email: normalizeEmail(row.data.email),
      role: row.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map(field => [field, row.data[field] === true])),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return sha256(canonicalJson(manifest));
}

function writeMatches(actual: any, write: RepairWrite): boolean {
  if (!actual) return false;
  if (!Object.entries(write.data).every(([key, value]) => canonicalJson(actual.data?.[key]) === canonicalJson(value))) return false;
  return (write.deleteFields ?? []).every(field => !(field in (actual.data ?? {})));
}

function toRestWrite(write: RepairWrite, databaseId: string): any {
  const update = {
    name: documentName(FIREBASE_PROJECT_ID, databaseId, write.collection, write.documentId),
    fields: encodeFields(write.data),
  };
  if (write.operation === 'create') return { update, currentDocument: { exists: false } };
  if (!('updateTime' in write.precondition)) throw new Error(`Update lacks updateTime: ${write.collection}/${write.documentId}`);
  const mask = [...new Set([...Object.keys(write.data), ...(write.deleteFields ?? [])])];
  if (mask.length === 0) throw new Error(`Update has no fields: ${write.collection}/${write.documentId}`);
  return {
    update,
    updateMask: { fieldPaths: mask.map(fieldPath) },
    currentDocument: { updateTime: write.precondition.updateTime },
  };
}

function batches(writes: RepairWrite[], databaseId: string): RepairWrite[][] {
  const result: RepairWrite[][] = [];
  let current: RepairWrite[] = [];
  let currentBytes = Buffer.byteLength('{"writes":[]}', 'utf8');
  for (const write of writes) {
    const bytes = Buffer.byteLength(JSON.stringify(toRestWrite(write, databaseId)), 'utf8') + 1;
    if (bytes > MAX_COMMIT_BODY_BYTES) throw new Error(`Single write exceeds commit guard: ${write.collection}/${write.documentId}`);
    if (current.length > 0 && (current.length >= MAX_WRITES_PER_COMMIT || currentBytes + bytes > MAX_COMMIT_BODY_BYTES)) {
      result.push(current);
      current = [write];
      currentBytes = Buffer.byteLength('{"writes":[]}', 'utf8') + bytes;
    } else {
      current.push(write);
      currentBytes += bytes;
    }
  }
  if (current.length > 0) result.push(current);
  return result;
}

async function commitBatch(databaseId: string, token: string, writes: RepairWrite[]): Promise<string> {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(databaseId)}/documents:commit`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: writes.map(write => toRestWrite(write, databaseId)) }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new Error(`Firestore rehearsal commit failed: ${response.status} ${await response.text()}`);
  const payload: any = await response.json();
  return String(payload.commitTime ?? '');
}

async function reconcilePrefix(databaseId: string, token: string, writes: RepairWrite[], completed: number): Promise<number> {
  if (completed >= writes.length) return completed;
  const rows = new Map<string, any>();
  for (const collection of [...new Set(writes.slice(completed).map(write => write.collection))]) {
    for (const row of await listCollection(FIREBASE_PROJECT_ID, databaseId, collection, token)) {
      rows.set(`${collection}|${row.id}`, row);
    }
  }
  let offset = completed;
  while (offset < writes.length) {
    const write = writes[offset];
    if (!writeMatches(rows.get(`${write.collection}|${write.documentId}`), write)) break;
    offset += 1;
  }
  return offset;
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const [runDirArg, databaseId, expectedRunId, expectedPlanHash] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  if (!runDirArg || !databaseId || !expectedRunId || !expectedPlanHash) {
    throw new Error('Usage: applyFunctionalRepair.ts <run-dir> <database-id> <repair-run-id> <plan-hash> --execute --rehearsal');
  }
  const production = process.argv.includes('--production');
  if (!process.argv.includes('--execute') || (!production && !process.argv.includes('--rehearsal'))) throw new Error('Refusing to write without --execute and an explicit mode');
  if (production) {
    if (databaseId !== FIRESTORE_DATABASE_ID) throw new Error('Production mode requires the default database');
  } else {
    if (databaseId === FIRESTORE_DATABASE_ID) throw new Error('Rehearsal mode cannot target the default database');
    if (!/^migration-repair-rehearsal-[a-z0-9-]+$/.test(databaseId)) throw new Error(`Unsafe rehearsal database ID: ${databaseId}`);
  }

  const runDir = path.resolve(runDirArg);
  const summary = readJson<any>(path.join(runDir, 'repair-dry-run-summary.json'));
  const verification = readJson<any>(path.join(runDir, 'repair-verification.json'));
  const rehearsalPlan = production ? null : readJson<any>(path.join(runDir, 'rehearsal-plan.json'));
  const manifest = readJson<any>(path.join(runDir, 'firestore/manifest.json'));
  const sourceWrites = readJsonLines(path.join(runDir, 'proposed-repair-writes.jsonl')) as RepairWrite[];
  const writes = production ? sourceWrites : readJsonLines(path.join(runDir, 'rehearsal-writes.jsonl')) as RepairWrite[];
  const actualSourcePlanHash = sha256(sourceWrites.map(canonicalJson).join('\n'));
  const actualRehearsalPlanHash = sha256(writes.map(canonicalJson).join('\n'));
  if (summary.repairRunId !== expectedRunId || verification.repairRunId !== expectedRunId) throw new Error('Repair run ID mismatch');
  if (summary.planHash !== expectedPlanHash || verification.planHash !== expectedPlanHash || actualSourcePlanHash !== expectedPlanHash) {
    throw new Error('Repair plan hash mismatch');
  }
  if (!production && (rehearsalPlan.databaseId !== databaseId || rehearsalPlan.repairRunId !== expectedRunId ||
      rehearsalPlan.sourcePlanHash !== expectedPlanHash || rehearsalPlan.planHash !== actualRehearsalPlanHash ||
      rehearsalPlan.restoredBeforeValuesVerified !== true || rehearsalPlan.writes !== writes.length)) {
    throw new Error('Rehearsal plan binding mismatch');
  }
  if (summary.status !== 'APPROVAL_READY_FOR_REHEARSAL' || verification.approvalReadyForRehearsal !== true) {
    throw new Error('Repair plan is not independently approved for rehearsal');
  }
  if (summary.operatorReviewRows !== 0 || verification.errors?.length) throw new Error('Repair plan still has blocking review or verification errors');
  if (manifest.managedBackupVerified !== true) throw new Error('Fresh managed backup has not been restore-verified');

  const token = firebaseAccessToken();
  const targetUsers = await listCollection(FIREBASE_PROJECT_ID, databaseId, 'Users', token);
  if (roleManifest(targetUsers) !== verification.roleManifestBefore) throw new Error(`${production ? 'Production' : 'Rehearsal'} privileged role manifest differs from the verified source snapshot`);

  const stateDir = path.join(runDir, 'apply');
  const statePath = path.join(stateDir, `${databaseId === FIRESTORE_DATABASE_ID ? '_default_' : databaseId}.json`);
  const state = fs.existsSync(statePath) ? readJson<any>(statePath) : {
    kind: production ? 'functional-repair-production-checkpoint' : 'functional-repair-rehearsal-checkpoint',
    repairRunId: expectedRunId,
    sourcePlanHash: expectedPlanHash,
    planHash: actualRehearsalPlanHash,
    projectId: FIREBASE_PROJECT_ID,
    databaseId,
    startedAt: new Date().toISOString(),
    completedByPhase: {},
    committedWrites: 0,
  };
  if (state.repairRunId !== expectedRunId || state.sourcePlanHash !== expectedPlanHash ||
      state.planHash !== actualRehearsalPlanHash || state.databaseId !== databaseId) {
    throw new Error(`Checkpoint does not match this rehearsal: ${statePath}`);
  }

  const grouped = new Map<number, RepairWrite[]>();
  for (const write of writes) grouped.set(write.phase, [...(grouped.get(write.phase) ?? []), write]);
  for (const phase of [...grouped.keys()].sort((a, b) => a - b)) {
    const phaseWrites = grouped.get(phase)!;
    let completed = Number(state.completedByPhase[String(phase)] ?? 0);
    if (completed < 0 || completed > phaseWrites.length) throw new Error(`Invalid phase checkpoint: ${phase}`);
    const reconciled = await reconcilePrefix(databaseId, token, phaseWrites, completed);
    if (reconciled > completed) {
      completed = reconciled;
      state.completedByPhase[String(phase)] = completed;
      state.committedWrites = Object.values(state.completedByPhase).reduce((sum: number, value: any) => sum + Number(value), 0);
      state.lastRecoveredAt = new Date().toISOString();
      writeJson(statePath, state);
    }
    for (const batch of batches(phaseWrites.slice(completed), databaseId)) {
      const commitTime = await commitBatch(databaseId, token, batch);
      completed += batch.length;
      state.completedByPhase[String(phase)] = completed;
      state.committedWrites = Object.values(state.completedByPhase).reduce((sum: number, value: any) => sum + Number(value), 0);
      state.lastCommitTime = commitTime;
      state.updatedAt = new Date().toISOString();
      writeJson(statePath, state);
      process.stdout.write(`${JSON.stringify({ phase, batchWrites: batch.length, completed, phaseWrites: phaseWrites.length, committedWrites: state.committedWrites })}\n`);
    }
  }
  state.status = 'complete';
  state.completedAt = new Date().toISOString();
  writeJson(statePath, state);
  process.stdout.write(`${JSON.stringify({ status: state.status, databaseId, repairRunId: expectedRunId, sourcePlanHash: expectedPlanHash, rehearsalPlanHash: actualRehearsalPlanHash, committedWrites: state.committedWrites }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
