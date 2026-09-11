/* eslint-disable @typescript-eslint/no-explicit-any -- Google long-running operation payloads are heterogeneous */
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID } from './config';
import { writeJson } from './common';
import { firebaseAccessToken } from './firestoreRest';

async function api(url: string, token: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Google API failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main(): Promise<void> {
  const [databaseId, inputUriPrefix, evidenceFile] = process.argv.slice(2);
  if (!databaseId || !inputUriPrefix) throw new Error('Usage: restoreFirestoreExport.ts <database-id> <gs://input-prefix> [evidence-file]');
  if (databaseId === FIRESTORE_DATABASE_ID) throw new Error('Refusing to import into the default database');
  if (!/^migration-[a-z0-9-]+$/.test(databaseId)) throw new Error(`Unsafe rehearsal database ID: ${databaseId}`);
  if (!inputUriPrefix.startsWith(`gs://${FIREBASE_PROJECT_ID}-firestore-migration-backups-`)) {
    throw new Error(`Unexpected backup prefix: ${inputUriPrefix}`);
  }
  const token = firebaseAccessToken();
  const endpoint = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${databaseId}:importDocuments`;
  let operation = await api(endpoint, token, { method: 'POST', body: JSON.stringify({ inputUriPrefix }) });
  process.stdout.write(`${JSON.stringify({ operation: operation.name, status: 'started' })}\n`);
  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    operation = await api(`https://firestore.googleapis.com/v1/${operation.name}`, token);
    const progress = operation.metadata?.progressDocuments;
    process.stdout.write(`${JSON.stringify({ operation: operation.name, completed: progress?.completedWork ?? null, estimated: progress?.estimatedWork ?? null, done: operation.done === true })}\n`);
  }
  if (operation.error) throw new Error(`Firestore import failed: ${JSON.stringify(operation.error)}`);
  if (evidenceFile) {
    writeJson(evidenceFile, {
      kind: 'firestore-managed-import-operation',
      databaseId,
      inputUriPrefix,
      operation: operation.name,
      completedAt: new Date().toISOString(),
      response: operation.response ?? null,
    });
  }
  process.stdout.write(`${JSON.stringify({ operation: operation.name, status: 'complete' }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
