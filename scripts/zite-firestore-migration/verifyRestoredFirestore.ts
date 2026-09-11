/* eslint-disable @typescript-eslint/no-explicit-any -- Google APIs return heterogeneous external JSON */
import fs from 'node:fs';
import path from 'node:path';
import { FIREBASE_PROJECT_ID } from './config';
import { canonicalJson, readJson, sha256, writeJson } from './common';

function firebaseAccessToken(): string {
  const file = '/home/vedanarayana_das/.config/configstore/firebase-tools.json';
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const token = parsed?.tokens?.access_token;
  if (!token) throw new Error('Firebase CLI access token unavailable');
  return token;
}

async function restoredCollectionCount(databaseId: string, collection: string, token: string): Promise<number> {
  let count = 0;
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collection)}`);
    url.searchParams.set('pageSize', '1000');
    url.searchParams.append('mask.fieldPaths', '__name__');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) return count;
    if (!response.ok) throw new Error(`Restored collection read failed for ${collection}: ${response.status} ${await response.text()}`);
    const payload: any = await response.json();
    count += (payload.documents ?? []).length;
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return count;
}

async function listBackupObjects(bucket: string, prefix: string, token: string): Promise<any[]> {
  const objects: any[] = [];
  let pageToken = '';
  do {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    url.searchParams.set('prefix', prefix);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Backup object listing failed: ${response.status} ${await response.text()}`);
    const payload: any = await response.json();
    objects.push(...(payload.items ?? []));
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  return objects;
}

async function main(): Promise<void> {
  const [runDirArg, restoredDatabaseId, bucket, prefix, exportOperation, importOperation] = process.argv.slice(2);
  if (!runDirArg || !restoredDatabaseId || !bucket || !prefix || !exportOperation || !importOperation) {
    throw new Error('Usage: verifyRestoredFirestore.ts <run-dir> <restored-db> <bucket> <prefix> <export-op> <import-op>');
  }
  const runDir = path.resolve(runDirArg);
  const manifestPath = path.join(runDir, 'firestore', 'manifest.json');
  const manifest = readJson<any>(manifestPath);
  const token = firebaseAccessToken();
  const restoredCounts: Array<{ collection: string; expected: number; actual: number }> = [];
  for (const table of manifest.tables) {
    const actual = await restoredCollectionCount(restoredDatabaseId, table.collection, token);
    restoredCounts.push({ collection: table.collection, expected: table.count, actual });
  }
  const mismatches = restoredCounts.filter((row) => row.actual !== row.expected);
  if (mismatches.length) throw new Error(`Restored collection count mismatch: ${JSON.stringify(mismatches)}`);

  const objects = await listBackupObjects(bucket, prefix, token);
  const metadataObjects = objects.filter((object) => String(object.name).endsWith('.overall_export_metadata'));
  if (objects.length === 0 || metadataObjects.length !== 1) {
    throw new Error(`Backup object verification failed: objects=${objects.length} metadata=${metadataObjects.length}`);
  }

  const unsignedEvidence = {
    kind: 'firestore-backup-restore-verification',
    verifiedAt: new Date().toISOString(),
    sourceDatabaseId: manifest.databaseId,
    restoredDatabaseId,
    outputUriPrefix: `gs://${bucket}/${prefix}`,
    exportOperation,
    importOperation,
    exportObjectCount: objects.length,
    exportBytes: objects.reduce((sum, object) => sum + Number(object.size ?? 0), 0),
    metadataObject: metadataObjects[0].name,
    restoredCounts,
    totalExpectedDocuments: restoredCounts.reduce((sum, row) => sum + row.expected, 0),
    totalRestoredDocuments: restoredCounts.reduce((sum, row) => sum + row.actual, 0),
  };
  const evidence = { ...unsignedEvidence, checksum: sha256(canonicalJson(unsignedEvidence)) };
  writeJson(path.join(runDir, 'firestore', 'backup-verification.json'), evidence);

  const unsignedManifest = { ...manifest };
  delete unsignedManifest.checksum;
  const updatedManifest = {
    ...unsignedManifest,
    managedBackupVerified: true,
    backupVerificationFile: 'backup-verification.json',
    backupVerificationChecksum: evidence.checksum,
  };
  writeJson(manifestPath, { ...updatedManifest, checksum: sha256(canonicalJson(updatedManifest)) });
  process.stdout.write(`${JSON.stringify({
    managedBackupVerified: true,
    totalRestoredDocuments: evidence.totalRestoredDocuments,
    exportObjectCount: evidence.exportObjectCount,
    exportBytes: evidence.exportBytes,
    evidenceChecksum: evidence.checksum,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
