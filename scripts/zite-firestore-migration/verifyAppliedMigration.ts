/* eslint-disable @typescript-eslint/no-explicit-any -- migration plans contain heterogeneous JSON values */
import path from 'node:path';
import { FIREBASE_PROJECT_ID, PERMISSION_FIELDS, PRIVILEGED_ROLES } from './config';
import { canonicalJson, normalizeEmail, readJson, readJsonLines, sha256, writeJson } from './common';
import { firebaseAccessToken, listCollection } from './firestoreRest';

function isPrivileged(data: Record<string, any>): boolean {
  return PRIVILEGED_ROLES.has(String(data.role ?? '').trim().toLowerCase()) || PERMISSION_FIELDS.some((field) => data[field] === true);
}

function subsetMatches(actual: any, expected: any): boolean {
  return Object.entries(expected).every(([key, value]) => canonicalJson(actual?.[key]) === canonicalJson(value));
}

async function main(): Promise<void> {
  const [runDirArg, databaseId, expectedRunId] = process.argv.slice(2);
  if (!runDirArg || !databaseId || !expectedRunId) throw new Error('Usage: node --import tsx verifyAppliedMigration.ts <run-dir> <database-id> <expected-run-id>');
  const runDir = path.resolve(runDirArg);
  const dryRunDir = path.join(runDir, 'dry-run');
  const summary = readJson<any>(path.join(dryRunDir, 'reconciliation-summary.json'));
  const approvedRoles = readJson<any>(path.join(dryRunDir, 'approved-role-map.json'));
  const writes = readJsonLines(path.join(dryRunDir, 'planned-writes.jsonl')) as any[];
  if (summary.runId !== expectedRunId) throw new Error('Run ID mismatch');
  const token = firebaseAccessToken();
  const byTarget = new Map<string, any>();
  const collections = [...new Set(writes.map((write) => write.collection))].sort();
  for (const collection of collections) {
    const rows = await listCollection(FIREBASE_PROJECT_ID, databaseId, collection, token);
    for (const row of rows) byTarget.set(`${collection}|${row.id}`, row);
    process.stdout.write(`${collection}: ${rows.length}\n`);
  }
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const write of writes) {
    const key = `${write.collection}|${write.documentId}`;
    const actual = byTarget.get(key);
    if (!actual) missing.push(key);
    else if (!subsetMatches(actual.data, write.data)) mismatched.push(key);
  }
  const users = [...byTarget.values()].filter((row) => byTarget.get(`Users|${row.id}`) === row);
  const roleManifest = users
    .filter((row) => normalizeEmail(row.data.email) && isPrivileged(row.data))
    .map((row) => ({
      documentId: row.id,
      email: normalizeEmail(row.data.email),
      role: row.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, row.data[field] === true])),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  const roleChecksum = sha256(canonicalJson(roleManifest));
  const verification = {
    kind: 'migration-apply-verification',
    runId: expectedRunId,
    databaseId,
    verifiedAt: new Date().toISOString(),
    passed: missing.length === 0 && mismatched.length === 0 && roleChecksum === approvedRoles.checksum,
    plannedWrites: writes.length,
    verifiedWrites: writes.length - missing.length - mismatched.length,
    missingCount: missing.length,
    mismatchCount: mismatched.length,
    roleManifestUnchanged: roleChecksum === approvedRoles.checksum,
    missing: missing.slice(0, 20),
    mismatched: mismatched.slice(0, 20),
  };
  writeJson(path.join(runDir, 'apply', `${databaseId.replace(/[^a-zA-Z0-9._-]/g, '_')}-verification.json`), verification);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
