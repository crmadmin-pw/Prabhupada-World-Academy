const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function setup() {
  const auth = { currentUser: { uid: 'AdminA', getIdToken: async () => 'test-token' } };
  const pending = [];
  const modules = new Map();
  const load = file => {
    if (modules.has(file)) return modules.get(file);
    const out = { exports: {} };
    modules.set(file, out.exports);
    const source = fs.readFileSync(`src/lib/${file}.ts`, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'fetch', 'process', code)(
      name => name === './app-auth-sdk' ? { auth } : load(name.replace('./', '')),
      out, out.exports, (url, options) => new Promise(resolve => pending.push({ url, input: JSON.parse(options.body), resolve })),
      { env: { NODE_ENV: 'production' } },
    );
    return out.exports;
  };
  const sdk = load('app-endpoints-sdk');
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const reply = (index, value, status = 200, headers = {}) => pending[index].resolve({ ok: status === 200, status, json: async () => value, headers: { get: name => headers[name] || null } });
  return { sdk, auth, pending, flush, reply };
}

test('equivalent filters and concurrent consumers share one read; cached revisit has no network', async () => {
  const { sdk, pending, flush, reply } = setup();
  const a = sdk.queryEndpoint('getGuideDetailedReport', { date: '2026-09-07', guideId: 'ALL', segment: undefined });
  const b = sdk.queryEndpoint('getGuideDetailedReport', { guideId: 'ALL', date: '2026-09-07' });
  await flush();
  assert.equal(pending.length, 1);
  reply(0, { users: [{ name: 'Test' }] });
  const [first, second] = await Promise.all([a, b]);
  first.users[0].name = 'Changed locally';
  assert.equal(second.users[0].name, 'Test');
  assert.deepEqual(await sdk.queryEndpoint('getGuideDetailedReport', { guideId: 'ALL', date: '2026-09-07' }), second);
  assert.equal(pending.length, 1);
});

test('committed query revisions invalidate exact reads without discarding unrelated in-flight queries', async () => {
  const { sdk, pending, flush, reply } = setup();
  const meeting = sdk.queryEndpoint('getMeetings', { department: 'PW' });
  const sadhana = sdk.queryEndpoint('getGuideDetailedReport', { guideId: 'ALL' });
  await flush();
  sdk.invalidateEndpointQueryKeys([sdk.queryCacheKey('getGuideDetailedReport', { guideId: 'ALL' })]);
  reply(0, { meetings: [] }); reply(1, { users: ['obsolete'] });
  await Promise.all([meeting, sadhana]);
  assert.ok(sdk.isEndpointQueryFresh('getMeetings', { department: 'PW' }));
  assert.equal(sdk.getEndpointCacheSnapshot('getGuideDetailedReport', { guideId: 'ALL' }), undefined);
  const a = sdk.updateMeeting({ meetingId: 'test' });
  const b = sdk.updateMeeting({ meetingId: 'test' });
  await flush();
  assert.equal(pending.length, 4);
  reply(2, { success: true }); reply(3, { success: true });
  await Promise.all([a, b]);
  assert.ok(sdk.getEndpointCacheSnapshot('getMeetings', { department: 'PW' }), 'mutation responses do not broadcast broad cache invalidations');
});

test('assigning a reading-group member refreshes that card without clearing unrelated queries', async () => {
  const { sdk, pending, flush, reply } = setup();
  const groups = sdk.queryEndpoint('getBvslGroups', { bvslId: 'ALL' });
  const meetings = sdk.queryEndpoint('getMeetings', { department: 'PW' });
  await flush();
  reply(0, { groups: [{ id: 'g', memberCount: 0 }] }, 200, { 'X-Realtime-Token': 'groups-token', 'X-Realtime-Version': '0001' });
  reply(1, { meetings: [] });
  await Promise.all([groups, meetings]);
  const assigned = sdk.approveAndAssignBvMember({ registrationId: 'reg', groupId: 'g' });
  await flush();
  assert.equal(pending.length, 3);
  reply(2, { success: true });
  await assigned;
  assert.equal(sdk.isEndpointQueryFresh('getBvslGroups', { bvslId: 'ALL' }), false);
  assert.equal(sdk.getEndpointCacheSnapshot('getBvslGroups', { bvslId: 'ALL' }).data.groups[0].memberCount, 0);
  assert.equal(sdk.getEndpointQueryRevision('getBvslGroups', { bvslId: 'ALL' }), 1);
  assert.ok(sdk.isEndpointQueryFresh('getMeetings', { department: 'PW' }));
  const approvalOnly = sdk.approveAndAssignBvMember({ registrationId: 'reg' });
  await flush();
  reply(3, { success: true });
  await approvalOnly;
  assert.equal(sdk.getEndpointQueryRevision('getBvslGroups', { bvslId: 'ALL' }), 1);
  assert.equal(sdk.getEndpointQueryRevision('getMeetings', { department: 'PW' }) || 0, 0);
});

test('an older in-flight response cannot roll back a reconciled query watermark', async () => {
  const { sdk, pending, flush, reply } = setup();
  const headers = version => ({ 'X-Realtime-Token': 'meeting-token', 'X-Realtime-Version': version });
  const first = sdk.queryEndpoint('getMeetings', {});
  await flush(); reply(0, { value: 1 }, 200, headers('0001')); await first;
  const old = sdk.queryEndpoint('getMeetings', { bypassCache: true });
  await flush();
  sdk.receiveEndpointRevision('meeting-token', '0003');
  const fresh = sdk.queryEndpoint('getMeetings', {});
  await flush(); reply(2, { value: 3 }, 200, headers('0003')); await fresh;
  reply(1, { value: 2 }, 200, headers('0002')); await old;
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', {}).data.value, 3);
  assert.ok(sdk.isEndpointQueryFresh('getMeetings', {}));
  assert.equal(sdk.getEndpointQueryRevision('getMeetings', {}), 1);
});

test('identity and role changes isolate caches and prevent old responses repopulating them', async () => {
  const { sdk, auth, pending, flush, reply } = setup();
  const first = sdk.queryEndpoint('getMeetings', { department: 'PW' });
  await flush();
  sdk.setEndpointPermissionScope('guide');
  reply(0, { meetings: ['admin-only'] }); await first;
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', { department: 'PW' }), undefined);
  const second = sdk.queryEndpoint('getMeetings', { department: 'PW' });
  await flush(); reply(1, { meetings: ['own'] }); await second;
  auth.currentUser.uid = 'admina';
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', { department: 'PW' }), undefined, 'Firebase IDs are case sensitive');
});

test('failed authorization removes cached data; failed reads can be retried', async () => {
  const { sdk, pending, flush, reply } = setup();
  const first = sdk.queryEndpoint('getMeetings', {});
  await flush(); reply(0, { meetings: ['old'] }); await first;
  const refresh = sdk.queryEndpoint('getMeetings', { bypassCache: true });
  await flush(); reply(1, { message: 'Forbidden' }, 403);
  await assert.rejects(refresh, error => error.status === 403);
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', {}), undefined);
  const retry = sdk.queryEndpoint('getMeetings', {});
  await flush(); reply(2, { meetings: [] });
  assert.deepEqual(await retry, { meetings: [] });
});

test('active consumers retain revisions through cache churn, then release subscriptions', async () => {
  const { sdk, pending, flush, reply } = setup();
  const key = sdk.queryCacheKey('getMeetings', { page: 'visible' });
  const releaseA = sdk.retainEndpointQuery(key);
  const releaseB = sdk.retainEndpointQuery(key);
  const load = async page => {
    const request = sdk.queryEndpoint('getMeetings', { page });
    await flush();
    reply(pending.length - 1, { page }, 200, { 'X-Realtime-Token': `token-${page}`, 'X-Realtime-Version': '0001' });
    await request;
  };
  await load('visible');
  for (let page = 0; page < 260; page++) await load(page);
  releaseA(); releaseA();
  assert.ok(sdk.getEndpointRealtimeTokens().includes('token-visible'), 'another mounted consumer still retains the query');
  sdk.receiveEndpointRevision('token-visible', '0002');
  assert.equal(sdk.isEndpointQueryFresh('getMeetings', { page: 'visible' }), false);
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', { page: 'visible' }).data.page, 'visible');
  releaseB();
  assert.equal(sdk.getEndpointRealtimeTokens().includes('token-visible'), false);
  assert.ok(sdk.getEndpointRealtimeTokens().length <= 250);
});

test('approving a member drops the cached directory so the next read cannot reuse it', async () => {
  const { sdk, pending, flush, reply } = setup();
  const headers = { 'X-Realtime-Token': 'directory-token', 'X-Realtime-Version': '0001' };
  const directory = sdk.queryEndpoint('getGuideUsers', { guideId: 'ALL', statusFilter: 'all' });
  await flush();
  reply(0, { users: [{ userId: 'existing', fullName: 'Existing' }] }, 200, headers);
  await directory;
  assert.equal(sdk.isEndpointQueryFresh('getGuideUsers', { guideId: 'ALL', statusFilter: 'all' }), true);
  const stale = sdk.queryEndpoint('getGuideUsers', { guideId: 'ALL', statusFilter: 'all', bypassCache: true });
  await flush();
  const approval = sdk.approveUser({ userId: 'new-member' });
  await flush();
  reply(pending.length - 1, { success: true });
  await approval;
  assert.equal(sdk.isEndpointQueryFresh('getGuideUsers', { guideId: 'ALL', statusFilter: 'all' }), false, 'approval must not leave the pre-approval directory fresh');
  const refreshed = sdk.queryEndpoint('getGuideUsers', { guideId: 'ALL', statusFilter: 'all' });
  await flush();
  reply(pending.length - 1, { users: [{ userId: 'new-member', fullName: 'New Devotee' }] }, 200, headers);
  assert.deepEqual(await refreshed, { users: [{ userId: 'new-member', fullName: 'New Devotee' }] });
  reply(1, { users: [{ userId: 'existing', fullName: 'Existing' }] }, 200, headers);
  await stale;
  assert.equal(sdk.getEndpointCacheSnapshot('getGuideUsers', { guideId: 'ALL', statusFilter: 'all' }).data.users[0].fullName, 'New Devotee');
});

test('an evicted in-flight request cannot overwrite the same query after re-registration', async () => {
  const { sdk, pending, flush, reply } = setup();
  const old = sdk.queryEndpoint('getMeetings', { page: 'evicted' });
  await flush();
  for (let page = 0; page < 251; page++) {
    const read = sdk.queryEndpoint('getMeetings', { page });
    await flush(); reply(pending.length - 1, { page }); await read;
  }
  const fresh = sdk.queryEndpoint('getMeetings', { page: 'evicted' });
  await flush(); reply(pending.length - 1, { value: 'fresh' }); await fresh;
  reply(0, { value: 'obsolete' }); await old;
  assert.equal(sdk.getEndpointCacheSnapshot('getMeetings', { page: 'evicted' }).data.value, 'fresh');
});
