/* eslint-disable @typescript-eslint/no-explicit-any -- Firebase Auth REST payloads contain heterogeneous values */
import path from 'node:path';
import { FIREBASE_PROJECT_ID, assertStaticConfiguration } from './config';
import { writeJson } from './common';
import { firebaseAccessToken } from './firestoreRest';

interface AuthUserSnapshot {
  localId: string;
  email: string;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
}

async function main(): Promise<void> {
  assertStaticConfiguration();
  const runDirArg = process.argv[2];
  if (!runDirArg) throw new Error('Usage: node --import tsx snapshotFirebaseAuth.ts <run-directory>');

  const token = firebaseAccessToken();
  const users: AuthUserSnapshot[] = [];
  let nextPageToken = '';
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:batchGet`);
    url.searchParams.set('maxResults', '1000');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Firebase Auth read failed: ${response.status} ${await response.text()}`);
    const payload: any = await response.json();
    for (const user of payload.users ?? []) {
      users.push({
        localId: String(user.localId ?? ''),
        email: String(user.email ?? ''),
        emailVerified: user.emailVerified === true,
        disabled: user.disabled === true,
        createdAt: user.createdAt ? String(user.createdAt) : null,
        lastLoginAt: user.lastLoginAt ? String(user.lastLoginAt) : null,
      });
    }
    nextPageToken = String(payload.nextPageToken ?? '');
  } while (nextPageToken);

  users.sort((a, b) => a.localId.localeCompare(b.localId));
  writeJson(path.join(path.resolve(runDirArg), 'firebase-auth.json'), {
    kind: 'firebase-auth-snapshot',
    projectId: FIREBASE_PROJECT_ID,
    capturedAt: new Date().toISOString(),
    readOnly: true,
    count: users.length,
    users,
  });
  process.stdout.write(`${JSON.stringify({ projectId: FIREBASE_PROJECT_ID, users: users.length }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
