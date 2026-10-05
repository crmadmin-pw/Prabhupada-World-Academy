import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';
import { verifyFirebaseIdToken } from '../src/lib/verifyFirebaseIdToken';

const projectId = 'demo-auth-security';
const email = 'administrator@example.invalid';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const claims = () => ({
  aud: projectId,
  iss: `https://securetoken.google.com/${projectId}`,
  sub: 'verified-user',
  email,
  email_verified: true,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  auth_time: Math.floor(Date.now() / 1000),
});
function signedToken(overrides: Record<string, unknown> = {}) {
  const body = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ ...claims(), ...overrides })}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url')}`;
}
const unsignedToken = () => `${encode({ alg: 'none' })}.${encode(claims())}.`;

test('authentication fails closed and verifies Firebase signatures and claims', async t => {
  const envNames = ['NODE_ENV', 'FIREBASE_AUTH_EMULATOR_HOST', 'NEXT_PUBLIC_USE_AUTH_EMULATOR'];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  t.after(() => {
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  Object.assign(process.env, { NODE_ENV: 'development' });

  await t.test('missing Admin initialization does not fall back to decoding', async () => {
    await assert.rejects(verifyFirebaseIdToken(unsignedToken()), /default Firebase app does not exist/);
  });

  const app = initializeApp({ projectId });
  t.after(() => deleteApp(app));
  // Replace only certificate retrieval. The real Admin SDK still validates
  // JWT signatures, issuer, audience and expiry; no service or credentials needed.
  const auth = getAuth() as unknown as {
    idTokenVerifier: { signatureVerifier: { keyFetcher: { fetchPublicKeys(): Promise<Record<string, string>> } } };
  };
  t.mock.method(auth.idTokenVerifier.signatureVerifier.keyFetcher, 'fetchPublicKeys', async () => ({
    'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }));

  for (const mode of ['production', 'development', 'test']) {
    await t.test(`${mode}: browser setting never permits mock or unsigned tokens`, async () => {
      Object.assign(process.env, { NODE_ENV: mode, NEXT_PUBLIC_USE_AUTH_EMULATOR: 'true' });
      await assert.rejects(verifyFirebaseIdToken(`mock_token_for_${email}`));
      await assert.rejects(verifyFirebaseIdToken(unsignedToken()));
      await assert.rejects(verifyFirebaseIdToken('malformed.token.value'));
    });
  }

  Object.assign(process.env, { NODE_ENV: 'production' });
  await t.test('a correctly signed token verifies and preserves email verification', async () => {
    const result = await verifyFirebaseIdToken(signedToken());
    assert.equal(result.uid, 'verified-user');
    assert.equal(result.email, email);
    assert.equal(result.email_verified, true);
    assert.equal((await verifyFirebaseIdToken(signedToken({ email_verified: false }))).email_verified, false);
  });
  await t.test('tampering, expiry, wrong audience and wrong issuer are rejected', async () => {
    const [header, , signature] = signedToken().split('.');
    await assert.rejects(verifyFirebaseIdToken(`${header}.${encode({ ...claims(), sub: 'super-admin' })}.${signature}`));
    await assert.rejects(verifyFirebaseIdToken(signedToken({ exp: 1 })), /expired/);
    await assert.rejects(verifyFirebaseIdToken(signedToken({ aud: 'another-project' })), /audience/);
    await assert.rejects(verifyFirebaseIdToken(signedToken({ iss: 'https://attacker.invalid' })), /issuer/);
  });
  await t.test('production rejects the server emulator setting before calling the SDK', async () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    try {
      await assert.rejects(verifyFirebaseIdToken(signedToken()), /must not be configured in production/);
      await assert.rejects(verifyFirebaseIdToken(unsignedToken()), /must not be configured in production/);
    } finally {
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    }
  });
  await t.test('production module initialization rejects emulator configuration', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval',
      "require('./src/lib/verifyFirebaseIdToken.ts')"], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not be configured in production/);
  });

  await t.test('API and upload routes reject forged tokens before any profile lookup', async t => {
    // Imports initialize the existing demo app only. Every profile operation is
    // trapped so this test can never read or write application data.
    const { Users } = await import('../src/lib/app-backend-sdk');
    for (const method of ['findOne', 'findAll', 'create', 'update'] as const) {
      t.mock.method(Users, method, async () => { assert.fail('Invalid authentication reached profile storage'); });
    }
    const { POST: run } = await import('../src/app/api/run/[endpoint]/route');
    const { POST: upload } = await import('../src/app/api/upload/route');
    t.mock.method(console, 'error', () => {});
    const request = (token: string) => new NextRequest('http://localhost/api/run/resolveUserLogin', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    for (const token of [`mock_token_for_${email}`, unsignedToken(), signedToken({ exp: 1 })]) {
      assert.equal((await run(request(token), { params: Promise.resolve({ endpoint: 'resolveUserLogin' }) })).status, 401);
      assert.equal((await upload(request(token))).status, 401);
    }
    const unverified = signedToken({ email_verified: false });
    assert.equal((await run(request(unverified), { params: Promise.resolve({ endpoint: 'resolveUserLogin' }) })).status, 403);
    assert.equal((await upload(request(unverified))).status, 403);
  });
});

test('browser authentication cannot mint tokens or trust localStorage identities', () => {
  const source = readFileSync('src/lib/app-auth-sdk.tsx', 'utf8');
  assert.doesNotMatch(source, /mock_token_for_|localStorage\.getItem\(['"]auth_(?:email|mock_mode)/);
  assert.match(source, /process\.env\.NODE_ENV !== 'production'\s*&& process\.env\.NEXT_PUBLIC_USE_AUTH_EMULATOR/);
});
