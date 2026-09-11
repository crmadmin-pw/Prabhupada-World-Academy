/* eslint-disable @typescript-eslint/no-explicit-any -- Google long-running operation payloads are heterogeneous */
import path from 'node:path';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, assertStaticConfiguration } from './config';
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
  assertStaticConfiguration();
  const [runDirArg, outputUriPrefix] = process.argv.slice(2);
  if (!runDirArg || !outputUriPrefix) throw new Error('Usage: exportFirestore.ts <run-dir> <gs://output-prefix>');
  if (!outputUriPrefix.startsWith(`gs://${FIREBASE_PROJECT_ID}-firestore-migration-backups-`)) {
    throw new Error(`Unexpected backup prefix: ${outputUriPrefix}`);
  }
  const token = firebaseAccessToken();
  const endpoint = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}:exportDocuments`;
  let operation = await api(endpoint, token, { method: 'POST', body: JSON.stringify({ outputUriPrefix }) });
  const operationName = String(operation.name ?? '');
  if (!operationName) throw new Error('Firestore export did not return an operation name');
  process.stdout.write(`${JSON.stringify({ operation: operationName, status: 'started' })}\n`);
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    operation = await api(`https://firestore.googleapis.com/v1/${operationName}`, token);
    const progress = operation.metadata?.progressDocuments;
    process.stdout.write(`${JSON.stringify({ operation: operationName, completed: progress?.completedWork ?? null, estimated: progress?.estimatedWork ?? null, done: operation.done === true })}\n`);
  }
  if (operation.error) throw new Error(`Firestore export failed: ${JSON.stringify(operation.error)}`);
  const evidence = {
    kind: 'firestore-managed-export-operation',
    sourceDatabaseId: FIRESTORE_DATABASE_ID,
    outputUriPrefix,
    operation: operationName,
    completedAt: new Date().toISOString(),
    response: operation.response ?? null,
  };
  writeJson(path.join(path.resolve(runDirArg), 'firestore', 'export-operation.json'), evidence);
  process.stdout.write(`${JSON.stringify({ operation: operationName, status: 'complete', outputUriPrefix }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
