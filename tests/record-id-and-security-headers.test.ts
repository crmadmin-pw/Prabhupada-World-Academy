import assert from 'node:assert/strict';
import test from 'node:test';

import nextConfig from '../next.config';
import { Config } from '../src/lib/app-backend-sdk';
import { contentSecurityPolicy } from '../src/lib/contentSecurityPolicy';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('a record created without an id receives a UUID', async () => {
  const first = await Config.create({ record: { note: 'uuid-a' } });
  const second = await Config.create({ record: { note: 'uuid-b' } });
  try {
    assert.match(first.id, UUID_V4);
    assert.match(second.id, UUID_V4);
    assert.notEqual(first.id, second.id);
    const stored = await Config.findOne({ id: first.id });
    assert.equal(stored?.note, 'uuid-a');
  } finally {
    await Config.delete({ id: first.id }).catch(() => undefined);
    await Config.delete({ id: second.id }).catch(() => undefined);
  }
});

test('an explicit record id is kept', async () => {
  const created = await Config.create({ record: { id: 'config-explicit-id', note: 'kept' } });
  try {
    assert.equal(created.id, 'config-explicit-id');
  } finally {
    await Config.delete({ id: created.id }).catch(() => undefined);
  }
});

test('response headers no longer send X-XSS-Protection', async () => {
  const groups = await nextConfig.headers();
  const names = groups.flatMap(group => group.headers.map(header => header.key));
  assert.equal(names.includes('X-XSS-Protection'), false);
  assert.equal(names.includes('X-Frame-Options'), true);
  assert.equal(names.includes('X-Content-Type-Options'), true);
  assert.equal(names.includes('Strict-Transport-Security'), true);
});

test('the content security policy allows framework scripts only with a nonce', () => {
  const policy = contentSecurityPolicy('noncevalue123', false);
  assert.match(policy, /script-src 'self' 'nonce-noncevalue123' 'strict-dynamic'/);
  assert.equal(policy.includes('unsafe-eval'), false);
  assert.equal(policy.includes('upgrade-insecure-requests'), true);
  assert.match(policy, /worker-src 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);

  const devPolicy = contentSecurityPolicy('devnonce', true);
  assert.match(devPolicy, /'unsafe-eval'/);
  assert.equal(devPolicy.includes('upgrade-insecure-requests'), false);
});
