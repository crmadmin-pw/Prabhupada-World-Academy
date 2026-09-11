/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore repair values are heterogeneous */
import path from 'node:path';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, PERMISSION_FIELDS, PRIVILEGED_ROLES, assertStaticConfiguration } from './config';
import { canonicalJson, normalizeEmail, readJson, readJsonLines, sha256, writeJson } from './common';
import { firebaseAccessToken, listCollection } from './firestoreRest';

interface RepairWrite {
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  deleteFields?: string[];
}

function roleManifest(rows: any[]): string {
  return sha256(canonicalJson(rows
    .filter(row => PRIVILEGED_ROLES.has(String(row.data.role ?? '').trim().toLowerCase()) || PERMISSION_FIELDS.some(field => row.data[field] === true))
    .map(row => ({
      id: row.id,
      email: normalizeEmail(row.data.email),
      role: row.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map(field => [field, row.data[field] === true])),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))));
}

function mainError(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const [runDirArg, databaseId, expectedRunId, expectedPlanHash] = process.argv.slice(2);
  if (!runDirArg || !databaseId || !expectedRunId || !expectedPlanHash) {
    mainError('Usage: verifyAppliedFunctionalRepair.ts <run-dir> <database-id> <repair-run-id> <plan-hash>');
  }
  if (databaseId === FIRESTORE_DATABASE_ID || !/^migration-repair-rehearsal-[a-z0-9-]+$/.test(databaseId)) {
    mainError(`Refusing to verify unsafe rehearsal database: ${databaseId}`);
  }
  const runDir = path.resolve(runDirArg);
  const summary = readJson<any>(path.join(runDir, 'repair-dry-run-summary.json'));
  const planVerification = readJson<any>(path.join(runDir, 'repair-verification.json'));
  const rehearsalPlan = readJson<any>(path.join(runDir, 'rehearsal-plan.json'));
  const sourceWrites = readJsonLines(path.join(runDir, 'proposed-repair-writes.jsonl')) as RepairWrite[];
  const writes = readJsonLines(path.join(runDir, 'rehearsal-writes.jsonl')) as RepairWrite[];
  const sourcePlanHash = sha256(sourceWrites.map(canonicalJson).join('\n'));
  const rehearsalPlanHash = sha256(writes.map(canonicalJson).join('\n'));
  if (summary.repairRunId !== expectedRunId || planVerification.repairRunId !== expectedRunId) mainError('Repair run ID mismatch');
  if (sourcePlanHash !== expectedPlanHash || summary.planHash !== expectedPlanHash || planVerification.planHash !== expectedPlanHash) mainError('Repair plan hash mismatch');
  if (rehearsalPlan.sourcePlanHash !== expectedPlanHash || rehearsalPlan.planHash !== rehearsalPlanHash || rehearsalPlan.databaseId !== databaseId) {
    mainError('Rehearsal plan binding mismatch');
  }

  const token = firebaseAccessToken();
  const touchedCollections = [...new Set(writes.map(write => write.collection))].sort();
  const actual = new Map<string, any>();
  for (const collection of touchedCollections) {
    for (const row of await listCollection(FIREBASE_PROJECT_ID, databaseId, collection, token)) {
      actual.set(`${collection}|${row.id}`, row);
    }
  }
  const failures: Array<{ collection: string; documentId: string; reason: string }> = [];
  for (const write of writes) {
    const row = actual.get(`${write.collection}|${write.documentId}`);
    if (!row) {
      failures.push({ collection: write.collection, documentId: write.documentId, reason: 'missing-document' });
      continue;
    }
    for (const [field, expected] of Object.entries(write.data)) {
      if (canonicalJson(row.data[field]) !== canonicalJson(expected)) {
        failures.push({ collection: write.collection, documentId: write.documentId, reason: `field-mismatch:${field}` });
      }
    }
    for (const field of write.deleteFields ?? []) {
      if (field in row.data) failures.push({ collection: write.collection, documentId: write.documentId, reason: `field-not-deleted:${field}` });
    }
  }
  const users = [...actual].filter(([key]) => key.startsWith('Users|')).map(([, row]) => row);
  if (roleManifest(users) !== planVerification.roleManifestAfter) {
    failures.push({ collection: 'Users', documentId: '*', reason: 'privileged-role-manifest-mismatch' });
  }
  const checkpoint = readJson<any>(path.join(runDir, 'apply', `${databaseId}.json`));
  if (checkpoint.status !== 'complete' || checkpoint.committedWrites !== writes.length) {
    failures.push({ collection: '_checkpoint', documentId: databaseId, reason: 'incomplete-apply-checkpoint' });
  }
  const result = {
    kind: 'functional-repair-rehearsal-verification',
    verifiedAt: new Date().toISOString(),
    databaseId,
    repairRunId: expectedRunId,
    sourcePlanHash: expectedPlanHash,
    rehearsalPlanHash,
    expectedWrites: writes.length,
    verifiedWrites: writes.length - new Set(failures.filter(failure => failure.documentId !== '*').map(failure => `${failure.collection}|${failure.documentId}`)).size,
    roleManifestUnchanged: roleManifest(users) === planVerification.roleManifestAfter,
    passed: failures.length === 0,
    failures,
  };
  writeJson(path.join(runDir, 'apply', `${databaseId}-verification.json`), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) mainError(`Functional repair rehearsal verification failed: ${failures.length} issue(s)`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
