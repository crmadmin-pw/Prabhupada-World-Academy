/* eslint-disable @typescript-eslint/no-explicit-any -- migration plans contain heterogeneous JSON values */
import fs from 'node:fs';
import path from 'node:path';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  NON_BLOCKING_MIGRATION_ASSERTIONS,
  PERMISSION_FIELDS,
  PRIVILEGED_ROLES,
  assertStaticConfiguration,
} from './config';
import { canonicalJson, normalizeEmail, readJson, readJsonLines, sha256, writeJson } from './common';
import { documentName, encodeFields, fieldPath, firebaseAccessToken, listCollection } from './firestoreRest';

interface PlannedWrite {
  phase: number;
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  precondition: { exists: false } | { updateTime: string };
}

const MAX_WRITES_PER_COMMIT = 500;
const MAX_COMMIT_BODY_BYTES = 8_000_000;

function privilegedRoleManifest(rows: any[]): any[] {
  return rows
    .filter((row) => normalizeEmail(row.data.email) && (
      PRIVILEGED_ROLES.has(String(row.data.role ?? '').trim().toLowerCase()) ||
      PERMISSION_FIELDS.some((field) => row.data[field] === true)
    ))
    .map((row) => ({
      documentId: row.id,
      email: normalizeEmail(row.data.email),
      role: row.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, row.data[field] === true])),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function subsetMatches(actual: any, expected: any): boolean {
  return Object.entries(expected).every(([key, value]) => canonicalJson(actual?.[key]) === canonicalJson(value));
}

async function reconcileCommittedPrefix(
  databaseId: string,
  token: string,
  phaseWrites: PlannedWrite[],
  completed: number,
): Promise<number> {
  if (completed >= phaseWrites.length) return completed;
  const rowsByTarget = new Map<string, any>();
  for (const collection of [...new Set(phaseWrites.slice(completed).map((write) => write.collection))]) {
    for (const row of await listCollection(FIREBASE_PROJECT_ID, databaseId, collection, token)) {
      rowsByTarget.set(`${collection}|${row.id}`, row);
    }
  }
  let reconciled = completed;
  while (reconciled < phaseWrites.length) {
    const write = phaseWrites[reconciled];
    const actual = rowsByTarget.get(`${write.collection}|${write.documentId}`);
    if (!actual || !subsetMatches(actual.data, write.data)) break;
    reconciled += 1;
  }
  return reconciled;
}

function toRestWrite(projectId: string, databaseId: string, write: PlannedWrite): any {
  const update = {
    name: documentName(projectId, databaseId, write.collection, write.documentId),
    fields: encodeFields(write.data),
  };
  if (write.operation === 'create') return { update, currentDocument: { exists: false } };
  if (!('updateTime' in write.precondition)) throw new Error(`Update lacks updateTime: ${write.collection}/${write.documentId}`);
  return {
    update,
    updateMask: { fieldPaths: Object.keys(write.data).map(fieldPath) },
    currentDocument: { updateTime: write.precondition.updateTime },
  };
}

function batches(writes: PlannedWrite[], projectId: string, databaseId: string): PlannedWrite[][] {
  const result: PlannedWrite[][] = [];
  let current: PlannedWrite[] = [];
  let currentBytes = Buffer.byteLength('{"writes":[]}', 'utf8');
  for (const write of writes) {
    const writeBytes = Buffer.byteLength(JSON.stringify(toRestWrite(projectId, databaseId, write)), 'utf8') + 1;
    if (writeBytes > MAX_COMMIT_BODY_BYTES) throw new Error(`Single write exceeds commit guard: ${write.collection}/${write.documentId}`);
    if (current.length > 0 && (current.length >= MAX_WRITES_PER_COMMIT || currentBytes + writeBytes > MAX_COMMIT_BODY_BYTES)) {
      result.push(current);
      current = [write];
      currentBytes = Buffer.byteLength('{"writes":[]}', 'utf8') + writeBytes;
    } else {
      current.push(write);
      currentBytes += writeBytes;
    }
  }
  if (current.length) result.push(current);
  return result;
}

async function commitBatch(databaseId: string, token: string, writes: PlannedWrite[]): Promise<string> {
  const body = { writes: writes.map((write) => toRestWrite(FIREBASE_PROJECT_ID, databaseId, write)) };
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(databaseId)}/documents:commit`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!response.ok) throw new Error(`Firestore commit failed: ${response.status} ${await response.text()}`);
  const payload: any = await response.json();
  return payload.commitTime ?? '';
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const [runDirArg, databaseId, expectedRunId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const execute = process.argv.includes('--execute');
  const production = process.argv.includes('--production');
  const rehearsal = process.argv.includes('--rehearsal');
  if (!runDirArg || !databaseId || !expectedRunId) {
    throw new Error('Usage: node --import tsx applyMigration.ts <run-dir> <database-id> <expected-run-id> --execute (--production|--rehearsal)');
  }
  if (!execute) throw new Error('Refusing to write without --execute');
  if (databaseId === FIRESTORE_DATABASE_ID && !production) throw new Error('Refusing to write the default database without --production');
  if (databaseId !== FIRESTORE_DATABASE_ID && production) throw new Error('--production is valid only for the default database');
  if (databaseId !== FIRESTORE_DATABASE_ID && !rehearsal) throw new Error('Refusing to write a named database without --rehearsal');
  if (production && rehearsal) throw new Error('Choose exactly one of --production or --rehearsal');

  const runDir = path.resolve(runDirArg);
  const dryRunDir = path.join(runDir, 'dry-run');
  const summary = readJson<any>(path.join(dryRunDir, 'reconciliation-summary.json'));
  const verification = readJson<any>(path.join(dryRunDir, 'verification.json'));
  const firestoreManifest = readJson<any>(path.join(runDir, 'firestore', 'manifest.json'));
  const approvedRoles = readJson<any>(path.join(dryRunDir, 'approved-role-map.json'));
  const writes = readJsonLines(path.join(dryRunDir, 'planned-writes.jsonl')) as PlannedWrite[];
  if (summary.runId !== expectedRunId || verification.runId !== expectedRunId || approvedRoles.runId !== expectedRunId) {
    throw new Error(`Run ID mismatch; expected ${expectedRunId}`);
  }
  if (!verification.planValid) throw new Error('Dry-run verification failed');
  if (production && (!summary.approvalReady || !verification.approvalReady)) throw new Error('Production dry run is not approval-ready');
  if (production && !firestoreManifest.managedBackupVerified) throw new Error('Managed backup is not verified');
  if (summary.manualReviewRows !== 0) throw new Error('Manual review rows remain');
  if (summary.plannedWrites !== writes.length) throw new Error('Planned write count mismatch');
  const blockingFailures = Object.entries(summary.assertions)
    .filter(([name]) => !NON_BLOCKING_MIGRATION_ASSERTIONS.has(name) && !(rehearsal && name === 'restorableFirestoreBackupVerified'))
    .filter(([, passed]) => passed !== true);
  if (blockingFailures.length) throw new Error(`Blocking assertions failed: ${blockingFailures.map(([name]) => name).join(', ')}`);

  const planChecksum = sha256(fs.readFileSync(path.join(dryRunDir, 'planned-writes.jsonl')));
  const token = firebaseAccessToken();
  const liveUsers = await listCollection(FIREBASE_PROJECT_ID, databaseId, 'Users', token);
  const liveRoleManifest = privilegedRoleManifest(liveUsers);
  const liveRoleChecksum = sha256(canonicalJson(liveRoleManifest));
  if (liveRoleChecksum !== approvedRoles.checksum) {
    throw new Error(`Privileged role manifest drift: planned ${approvedRoles.checksum}, live ${liveRoleChecksum}`);
  }

  const stateDir = path.join(runDir, 'apply');
  const statePath = path.join(stateDir, `${databaseId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
  const state = fs.existsSync(statePath)
    ? readJson<any>(statePath)
    : {
      kind: 'migration-apply-checkpoint',
      runId: expectedRunId,
      projectId: FIREBASE_PROJECT_ID,
      databaseId,
      planChecksum,
      startedAt: new Date().toISOString(),
      completedBatches: {},
      committedWrites: 0,
    };
  if (state.runId !== expectedRunId || state.databaseId !== databaseId || state.planChecksum !== planChecksum) {
    throw new Error(`Checkpoint does not match this plan: ${statePath}`);
  }

  // Checkpoints created by the initial conservative executor used numbered
  // 200-write batches. Convert them once to phase offsets so later runs can
  // change safe batch sizes without repeating an already committed write.
  if (!state.completedByPhase) {
    state.completedByPhase = {};
    for (const [key, value] of Object.entries(state.completedBatches ?? {}) as Array<[string, any]>) {
      const match = /^(\d+):(\d+)$/.exec(key);
      if (!match) continue;
      const phase = match[1];
      state.completedByPhase[phase] = (state.completedByPhase[phase] ?? 0) + Number(value.writes ?? 0);
    }
    state.committedWrites = Object.values(state.completedByPhase).reduce((sum: number, count: any) => sum + Number(count), 0);
    state.checkpointFormat = 'phase-offset-v2';
    writeJson(statePath, state);
  }

  const grouped = new Map<number, PlannedWrite[]>();
  for (const write of writes) grouped.set(write.phase, [...(grouped.get(write.phase) ?? []), write]);
  for (const phase of [...grouped.keys()].sort((a, b) => a - b)) {
    const phaseWrites = grouped.get(phase)!;
    let completedInPhase = Number(state.completedByPhase[String(phase)] ?? 0);
    if (completedInPhase < 0 || completedInPhase > phaseWrites.length) throw new Error(`Invalid checkpoint offset for phase ${phase}`);
    const reconciledInPhase = await reconcileCommittedPrefix(databaseId, token, phaseWrites, completedInPhase);
    if (reconciledInPhase > completedInPhase) {
      state.recoveredAmbiguousWrites = (state.recoveredAmbiguousWrites ?? 0) + reconciledInPhase - completedInPhase;
      completedInPhase = reconciledInPhase;
      state.completedByPhase[String(phase)] = completedInPhase;
      state.committedWrites = Object.values(state.completedByPhase).reduce((sum: number, count: any) => sum + Number(count), 0);
      state.lastRecoveredAt = new Date().toISOString();
      writeJson(statePath, state);
      process.stdout.write(`${JSON.stringify({ phase, recoveredCommittedPrefix: completedInPhase })}\n`);
    }
    const phaseBatches = batches(phaseWrites.slice(completedInPhase), FIREBASE_PROJECT_ID, databaseId);
    for (let index = 0; index < phaseBatches.length; index += 1) {
      const batch = phaseBatches[index];
      const key = `offset:${phase}:${String(completedInPhase).padStart(8, '0')}`;
      const digest = sha256(canonicalJson(batch));
      if (state.completedBatches[key]) {
        if (state.completedBatches[key].digest !== digest) throw new Error(`Checkpoint digest mismatch for ${key}`);
        completedInPhase += batch.length;
        continue;
      }
      const commitTime = await commitBatch(databaseId, token, batch);
      state.completedBatches[key] = { digest, writes: batch.length, commitTime };
      completedInPhase += batch.length;
      state.completedByPhase[String(phase)] = completedInPhase;
      state.committedWrites = Object.values(state.completedByPhase).reduce((sum: number, count: any) => sum + Number(count), 0);
      state.lastCompletedBatch = key;
      state.updatedAt = new Date().toISOString();
      writeJson(statePath, state);
      process.stdout.write(`${JSON.stringify({ phase, batch: index + 1, batches: phaseBatches.length, writes: batch.length, completedInPhase, phaseWrites: phaseWrites.length, committedWrites: state.committedWrites })}\n`);
    }
  }
  state.completedAt = new Date().toISOString();
  state.status = 'complete';
  writeJson(statePath, state);
  process.stdout.write(`${JSON.stringify({ status: state.status, runId: expectedRunId, databaseId, committedWrites: state.committedWrites, statePath }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
