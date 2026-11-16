import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import setTargets from '../src/api/setPwSadhanaTargets';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import { withRequestQueries } from '../src/lib/requestQueries';

test('the current PW RGF can assign all six member targets despite a stale reporting chain', async t => {
  const actor = { id: 'hrvd-doc', userId: 'HRVD', email: 'hrvd@example.invalid', fullName: 'HRVD PW',
    role: 'Admin', status: 'Active', segment: 'PW', isBvAdmin: true, isBvSupervisor: true, isBvFacilitator: true, isBvsl: true };
  const member = { id: 'abhishek-doc', userId: 'ABHISHEK', email: 'abhishek@example.invalid', firebaseUid: 'abhishek-login',
    fullName: 'Abhishek Sud', role: 'User', status: 'Active', segment: 'PW', bvGroupId: 'SRI-JIVA',
    bvReportingFacilitatorId: actor.userId, reportingChain: ['previous-rgf'], reportingScopeKeys: ['abhishek-doc'] };
  const group = { id: 'sri-jiva-doc', groupId: 'SRI-JIVA', groupName: 'Sri Jiva', segment: 'PW', isActive: true,
    bvslLeader: actor.id, bvslId: actor.userId, bvslName: actor.fullName };
  const membership: Record<string, unknown> = { id: 'membership', user: member.firebaseUid, group: group.id, groupId: group.groupId };
  const records: Record<string, Record<string, unknown>[]> = {
    Users: [actor, member], BvGroups: [group], BvGroupMembers: [membership],
    Config: [{ id: 'chains', configKey: sdk.REPORTING_CHAINS_KEY, configValue: sdk.REPORTING_CHAINS_READY }],
  };
  for (const [name, table] of Object.entries(sdk)) {
    const api = table as typeof sdk.Users;
    if (typeof api?.findAll !== 'function') continue;
    const query = (options: { id?: string; filters?: Record<string, unknown>; fields?: string[] } = {}) => {
      const matches = (row: Record<string, unknown>) => (!options.id || row.id === options.id) &&
        Object.entries(options.filters || {}).every(([key, expected]) => {
          const values = [row[key]].flat();
          if (expected && typeof expected === 'object') {
            const filter = expected as { in?: unknown[]; arrayContainsAny?: unknown[] };
            if (filter.in) return values.some(value => filter.in!.includes(value));
            if (filter.arrayContainsAny) return values.some(value => filter.arrayContainsAny!.includes(value));
          }
          return values.includes(expected);
        });
      return { records: (records[name] || []).filter(matches).map(row => options.fields
        ? Object.fromEntries(['id', ...options.fields].map(key => [key, row[key]])) : { ...row }), hasMore: false };
    };
    t.mock.method(api, 'findAll', async (options = {}) => query(options));
    t.mock.method(api, 'findOne', async (options = {}) => query(options).records[0] || null);
  }
  const updates: { id: string; record: Record<string, unknown> }[] = [];
  t.mock.method(sdk.Users, 'update', async (update: { id: string; record: Record<string, unknown> }) => {
    updates.push(update);
    return update;
  });
  const input = { userId: member.userId, groupId: group.groupId, wakeUp: '05:00', sleep: '22:00',
    chantingRounds: 7, readingMinutes: 20, hearingMinutes: 30, sevaMinutes: 10 };
  const run = (body = input, caller = actor) => withHierarchyDatabase({}, async () =>
    (await withRequestQueries(() => setTargets.execute({ input: body, context: { user: caller } } as never))).result);
  const result = await run();
  assert.equal(result.success, true);
  assert.deepEqual(result.pwTargets, { wakeUp: '05:00', sleep: '22:00', chanting: 7, readingMin: 20, hearingMin: 30, sevaMin: 10,
    setBy: actor.id, setByRole: 'rgf', updatedAt: result.pwTargets.updatedAt });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, member.id);
  // A single unambiguous group also works for older callers without groupId.
  await run({ ...input, groupId: undefined } as unknown as typeof input);
  assert.equal(updates.length, 2);
  await run(input, { ...actor, role: 'User', isBvAdmin: false, isBvSupervisor: false });
  assert.equal(updates.length, 3);
  const denied = async (label: string, mutate: () => void, undo: () => void, body = input, caller = actor) => {
    mutate();
    try {
      await assert.rejects(run(body, caller), (error: unknown) => (error as { code?: string }).code === 'FORBIDDEN', label);
      assert.equal(updates.length, 3, `${label}: no writes`);
    } finally { undo(); }
  };
  await denied('a mismatched selected group', () => {}, () => {}, { ...input, groupId: 'OTHER-GROUP' });
  await denied('a different RGF', () => { group.bvslLeader = 'other'; group.bvslId = 'OTHER'; group.bvslName = 'Other'; },
    () => { group.bvslLeader = actor.id; group.bvslId = actor.userId; group.bvslName = actor.fullName; });
  await denied('an inactive group', () => { group.isActive = false; }, () => { group.isActive = true; });
  await denied('a FOLK group', () => { group.segment = 'FOLK'; }, () => { group.segment = 'PW'; });
  await denied('an inactive membership', () => { membership.isActive = false; }, () => { delete membership.isActive; });
  await denied('a removed membership', () => { membership.status = 'Removed'; }, () => { delete membership.status; });
  await denied('an unrelated member', () => { membership.user = 'someone-else'; }, () => { membership.user = member.firebaseUid; });
  await denied('a deleted profile', () => { member.status = 'Account Deleted'; }, () => { member.status = 'Active'; });
  await denied('an RGF staff target outside the admin hierarchy', () => { member.role = 'RGF'; }, () => { member.role = 'User'; });
  await denied('an admin target', () => { member.role = 'Admin'; }, () => { member.role = 'User'; });
  await denied('a super-admin target', () => { member.role = 'SUPER_ADMIN'; }, () => { member.role = 'User'; });
  // Being another group's RGF, or this group's supervisor, is insufficient.
  await denied('a supervisor who is not this group RGF', () => { group.bvslLeader = 'other'; group.bvslId = 'OTHER'; group.bvslName = 'Other'; },
    () => { group.bvslLeader = actor.id; group.bvslId = actor.userId; group.bvslName = actor.fullName; }, input,
    { ...actor, role: 'User', isBvAdmin: false, isBvFacilitator: false, isBvsl: false });
});
