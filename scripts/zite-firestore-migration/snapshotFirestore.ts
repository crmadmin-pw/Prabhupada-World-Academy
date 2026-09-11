/* eslint-disable @typescript-eslint/no-explicit-any -- Firestore REST values are decoded from heterogeneous JSON */
import fs from 'node:fs';
import path from 'node:path';
import {
  FIREBASE_PROJECT_ID,
  FIRESTORE_DATABASE_ID,
  ARCHIVE_CHUNKS_COLLECTION,
  ARCHIVE_COLLECTION,
  LEDGER_COLLECTION,
  RUN_COLLECTION,
  SOURCE_TABLES,
  assertStaticConfiguration,
} from './config';
import { canonicalJson, safeFileName, sha256, writeJson, writeJsonLines } from './common';

type FirestoreValue = Record<string, any>;

function decodeValue(value: FirestoreValue): any {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return { __type: 'bytes', base64: value.bytesValue };
  if ('referenceValue' in value) return { __type: 'reference', value: value.referenceValue };
  if ('geoPointValue' in value) return { __type: 'geoPoint', ...value.geoPointValue };
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new Error(`Unsupported Firestore REST value: ${JSON.stringify(value).slice(0, 200)}`);
}

function decodeFields(fields: Record<string, FirestoreValue>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

function firebaseAccessToken(): string {
  const candidates = [
    process.env.FIREBASE_ACCESS_TOKEN,
    (() => {
      const file = '/home/vedanarayana_das/.config/configstore/firebase-tools.json';
      if (!fs.existsSync(file)) return '';
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed?.tokens?.access_token ?? '';
    })(),
  ];
  const token = candidates.find((value) => typeof value === 'string' && value.length > 0);
  if (!token) throw new Error('Firebase CLI access token unavailable. Run firebase login first.');
  return token;
}

async function fetchCollection(collection: string, token: string, databaseId: string): Promise<any[]> {
  const rows: any[] = [];
  let pageToken = '';
  do {
    const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collection)}`;
    const url = new URL(base);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) break;
    if (!response.ok) throw new Error(`Firestore read failed for ${collection}: ${response.status} ${await response.text()}`);
    const payload: any = await response.json();
    for (const document of payload.documents ?? []) {
      rows.push({
        id: decodeURIComponent(String(document.name).split('/').at(-1) ?? ''),
        createTime: document.createTime,
        updateTime: document.updateTime,
        data: decodeFields(document.fields ?? {}),
      });
    }
    pageToken = payload.nextPageToken ?? '';
  } while (pageToken);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const runDirArg = process.argv[2];
  const databaseId = process.argv[3] ?? FIRESTORE_DATABASE_ID;
  if (!runDirArg) throw new Error('Usage: npx tsx snapshotFirestore.ts <run-directory> [database-id]');
  const runDir = path.resolve(runDirArg);
  const outputDir = path.join(runDir, 'firestore');
  if (fs.existsSync(path.join(outputDir, 'manifest.json'))) {
    throw new Error(`Refusing to overwrite an existing Firestore snapshot: ${outputDir}`);
  }

  const token = firebaseAccessToken();
  const collections = [...new Set([
    ...SOURCE_TABLES.filter((table) => table.destination).map((table) => table.destination!),
    'PushSubscriptions',
    ARCHIVE_COLLECTION,
    ARCHIVE_CHUNKS_COLLECTION,
    LEDGER_COLLECTION,
    RUN_COLLECTION,
  ])].sort();
  const tables: any[] = [];
  for (const collection of collections) {
    const rows = await fetchCollection(collection, token, databaseId);
    const relativeFile = `tables/${safeFileName(collection)}.jsonl`;
    writeJsonLines(path.join(outputDir, relativeFile), rows);
    tables.push({
      collection,
      file: relativeFile,
      count: rows.length,
      checksum: sha256(rows.map(canonicalJson).join('\n')),
      maxUpdateTime: rows.map((row) => row.updateTime).filter(Boolean).sort().at(-1) ?? null,
    });
    process.stdout.write(`${collection}: ${rows.length}\n`);
  }

  const manifest = {
    kind: 'firestore-snapshot',
    projectId: FIREBASE_PROJECT_ID,
    databaseId,
    capturedAt: new Date().toISOString(),
    readOnly: true,
    tables,
  };
  writeJson(path.join(outputDir, 'manifest.json'), {
    ...manifest,
    checksum: sha256(canonicalJson(manifest)),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
