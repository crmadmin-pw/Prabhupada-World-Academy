import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemorySharedServerCache, createServerCache } from '../src/lib/serverCache';

test('reference lists are shared across servers and dropped together when they change', async () => {
  const shared = createMemorySharedServerCache();
  const serverA = createServerCache(shared);
  const serverB = createServerCache(shared);
  let builds = 0;
  const loadGuides = async () => ({ guides: [`guide-${++builds}`] });

  assert.deepEqual(await serverA.getOrFetch('ref:guides_v4', loadGuides, 60_000), { guides: ['guide-1'] });
  assert.deepEqual(await serverB.getOrFetch('ref:guides_v4', loadGuides, 60_000), { guides: ['guide-1'] });
  assert.equal(builds, 1);

  await serverA.invalidate('ref:guides');
  assert.deepEqual(await serverB.getOrFetch('ref:guides_v4', loadGuides, 60_000), { guides: ['guide-2'] });
  assert.equal(builds, 2);
  assert.deepEqual(await serverA.getOrFetch('ref:guides_v4', loadGuides, 60_000), { guides: ['guide-2'] });
  assert.equal(builds, 2);

  await serverA.invalidate('user_profile:');
  assert.deepEqual(await serverB.getOrFetch('ref:guides_v4', loadGuides, 60_000), { guides: ['guide-2'] });
  assert.equal(builds, 2);
});

test('one server reuses an in-flight reference fetch and keeps private caches local', async () => {
  const shared = createMemorySharedServerCache();
  const serverA = createServerCache(shared);
  const serverB = createServerCache(shared);
  let guideBuilds = 0;
  const loadGuides = async () => {
    guideBuilds++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return { guides: ['shared'] };
  };
  const [first, second] = await Promise.all([
    serverA.getOrFetch('ref:residencies_v3', loadGuides, 60_000),
    serverA.getOrFetch('ref:residencies_v3', loadGuides, 60_000),
  ]);
  assert.deepEqual(first, { guides: ['shared'] });
  assert.deepEqual(second, { guides: ['shared'] });
  assert.equal(guideBuilds, 1);

  let profileBuilds = 0;
  const loadProfile = async () => ({ id: ++profileBuilds });
  await serverA.getOrFetch('user_profile:1', loadProfile, 60_000);
  await serverB.getOrFetch('user_profile:1', loadProfile, 60_000);
  assert.equal(profileBuilds, 2);
});
