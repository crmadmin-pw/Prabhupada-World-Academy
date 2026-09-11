/* eslint-disable @typescript-eslint/no-explicit-any -- repair plans and Firestore snapshots contain heterogeneous values */
import path from 'node:path';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, assertStaticConfiguration } from './config';
import { canonicalJson, readJson, readJsonLines, sha256, writeJson, writeJsonLines } from './common';
import { firebaseAccessToken, listCollection } from './firestoreRest';

interface RepairWrite {
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  deleteFields?: string[];
  before?: Record<string, any>;
  precondition: { exists: false } | { updateTime: string };
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const [runDirArg, databaseId, expectedRunId, expectedSourcePlanHash] = process.argv.slice(2);
  if (!runDirArg || !databaseId || !expectedRunId || !expectedSourcePlanHash) {
    throw new Error('Usage: rebaseFunctionalRepairForRehearsal.ts <run-dir> <database-id> <repair-run-id> <source-plan-hash>');
  }
  if (databaseId === FIRESTORE_DATABASE_ID || !/^migration-repair-rehearsal-[a-z0-9-]+$/.test(databaseId)) {
    throw new Error(`Unsafe rehearsal database ID: ${databaseId}`);
  }
  const runDir = path.resolve(runDirArg);
  const summary = readJson<any>(path.join(runDir, 'repair-dry-run-summary.json'));
  const verification = readJson<any>(path.join(runDir, 'repair-verification.json'));
  const sourceWrites = readJsonLines(path.join(runDir, 'proposed-repair-writes.jsonl')) as RepairWrite[];
  const sourcePlanHash = sha256(sourceWrites.map(canonicalJson).join('\n'));
  if (summary.repairRunId !== expectedRunId || verification.repairRunId !== expectedRunId) throw new Error('Repair run ID mismatch');
  if (sourcePlanHash !== expectedSourcePlanHash || summary.planHash !== expectedSourcePlanHash || verification.planHash !== expectedSourcePlanHash) {
    throw new Error('Source repair plan hash mismatch');
  }
  if (verification.approvalReadyForRehearsal !== true) throw new Error('Source repair plan is not verified for rehearsal');

  const token = firebaseAccessToken();
  const restored = new Map<string, any>();
  for (const collection of [...new Set(sourceWrites.map(write => write.collection))]) {
    for (const row of await listCollection(FIREBASE_PROJECT_ID, databaseId, collection, token)) {
      restored.set(`${collection}|${row.id}`, row);
    }
  }
  const errors: string[] = [];
  const writes = sourceWrites.map(write => {
    const key = `${write.collection}|${write.documentId}`;
    const row = restored.get(key);
    if (write.operation === 'create') {
      if (row) errors.push(`Create target exists in rehearsal: ${key}`);
      return write;
    }
    if (!row?.updateTime) {
      errors.push(`Update target missing in rehearsal: ${key}`);
      return write;
    }
    if (!write.before) errors.push(`Update lacks before evidence: ${key}`);
    for (const [field, expected] of Object.entries(write.before ?? {})) {
      if (canonicalJson(row.data[field]) !== canonicalJson(expected)) errors.push(`Restored before-value mismatch: ${key}.${field}`);
    }
    return { ...write, precondition: { updateTime: row.updateTime } };
  });
  if (errors.length > 0) throw new Error(`Cannot safely rebase rehearsal plan: ${errors.slice(0, 20).join('; ')}`);
  const planHash = sha256(writes.map(canonicalJson).join('\n'));
  writeJsonLines(path.join(runDir, 'rehearsal-writes.jsonl'), writes);
  const artifact = {
    kind: 'functional-repair-rehearsal-plan',
    generatedAt: new Date().toISOString(),
    databaseId,
    repairRunId: expectedRunId,
    sourcePlanHash,
    planHash,
    writes: writes.length,
    restoredBeforeValuesVerified: true,
    roleManifestBefore: verification.roleManifestBefore,
  };
  writeJson(path.join(runDir, 'rehearsal-plan.json'), artifact);
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
