import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getData from '../src/api/getBvslOneToOneData';
import logMeeting from '../src/api/logOneToOneMeeting';
import getContext from '../src/api/getOneToOneContext';
import { resolveBvScopedGroups } from '../src/lib/bvGroupMemberScope';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import { serverCacheInvalidate } from '../src/lib/serverCache';

type Row = Record<string, unknown>;
function fixture(t: TestContext, segment = 'PW') {
  serverCacheInvalidate();
  const sonia = { id: 'sonia', userId: 'USER-SONIA', fullName: 'Sonia Uppal', email: 'sonia@example.test',
    segment, status: 'Active', role: 'User', isBvFacilitator: true, isBvsl: true, isBvSupervisor: true, isBvMentor: true };
  const member = (id: string) => ({ id, userId: `USER-${id}`, email: `${id}@example.test`, fullName: id, segment, role: 'User', status: 'Active' });
  const rows: Record<string, Row[]> = {
    Users: [sonia, { ...member('ramya'), isBvFacilitator: true }, { ...member('asha'), isBvFacilitator: true }, member('own-member'), member('supervised-member'), member('foreign-member')],
    BvGroups: [
      { id: 'gauranga', groupId: 'GAURANGA', groupName: 'Gauranga', segment, isActive: true, bvslLeader: ['ramya', sonia.id], bvslId: ['USER-ramya', sonia.userId], bvslName: ['Ramya', sonia.fullName] },
      { id: 'gadadhara', groupId: 'GADADHARA', groupName: 'Gadadhara', segment, isActive: true, bvslLeader: 'asha', bvslId: 'USER-asha', supervisorId: sonia.id },
      { id: 'foreign', groupId: 'FOREIGN', groupName: 'Foreign', segment, isActive: true, bvslLeader: 'outsider' },
    ],
    BvGroupMembers: [
      { id: 'own', groupId: 'GAURANGA', user: ['USER-own-member'] },
      { id: 'supervised', group: 'gadadhara', userId: 'USER-supervised-member' },
      { id: 'foreign', group: 'foreign', user: 'foreign-member' },
    ],
    OneToOneMeetings: [],
  };
  for (const [name, table] of Object.entries(sdk)) {
    if (!table || typeof table !== 'object' || !('findAll' in table)) continue;
    const query = (q: { id?: string; filters?: Row; fields?: string[]; offset?: number; limit?: number } = {}) => {
      const selected = (rows[name] || []).filter(row => (!q.id || row.id === q.id) && Object.entries(q.filters || {}).every(([key, value]) => {
        const raw = row[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const filter = value as Row;
          if (filter.in) return [raw].flat().some(item => (filter.in as unknown[]).includes(item));
          if (filter.arrayContains) return Array.isArray(raw) && raw.includes(filter.arrayContains);
          return (!filter.gte || String(raw) >= String(filter.gte)) && (!filter.lte || String(raw) <= String(filter.lte));
        }
        return [raw].flat().includes(value);
      }));
      const offset = q.offset || 0;
      const result = selected.slice(offset, offset + (q.limit || 5000));
      return { records: result.map(row => q.fields ? Object.fromEntries(['id', ...q.fields].map(key => [key, row[key]])) : { ...row }), hasMore: offset + result.length < selected.length };
    };
    t.mock.method(table, 'findAll', async (q: Parameters<typeof query>[0]) => query(q));
    t.mock.method(table, 'findOne', async (q: Parameters<typeof query>[0]) => query(q).records[0]);
  }
  t.mock.method(sdk.OneToOneMeetings, 'create', async ({ record }: { record: Row }) => {
    const row = { ...record, id: `meeting-${rows.OneToOneMeetings.length}` };
    rows.OneToOneMeetings.push(row);
    return row;
  });
  return { sonia, rows };
}

for (const segment of ['PW', 'FOLK'] as const) {
  test(`${segment}: dual RGF/supervisor sees her own co-led group in RGF view and assigned groups in supervisor view`, async t => {
    const { sonia } = fixture(t, segment);
    await withHierarchyDatabase(null, async () => {
      const own = await getData.execute({ input: { department: segment, viewScope: 'facilitator' }, context: { user: sonia } } as never);
      assert.deepEqual(own.users.map((user: { userId: string }) => user.userId).sort(), ['own-member', 'ramya']);
      assert.ok(own.users.every((user: { groupName: string }) => user.groupName === 'Gauranga'));
      const supervision = await getData.execute({ input: { department: segment, viewScope: 'supervisor' }, context: { user: sonia } } as never);
      assert.deepEqual(supervision.users.map((user: { userId: string }) => user.userId).sort(), ['asha', 'supervised-member']);
      assert.ok(supervision.users.every((user: { groupName: string }) => user.groupName === 'Gadadhara'));
      const week = own.weeks.at(-1);
      await logMeeting.execute({ input: { memberId: 'own-member', weekDate: week, meetingDate: week, durationMinutes: 20, notes: 'Own group call', recordingLink: 'https://example.test/recording' }, context: { user: sonia } } as never);
      const refreshed = await getData.execute({ input: { department: segment, viewScope: 'facilitator' }, context: { user: sonia } } as never);
      assert.equal(refreshed.meetings[0].memberId, 'own-member');
      assert.equal(refreshed.meetings[0].guideId, sonia.id);
      assert.equal(refreshed.meetings[0].recordingLink, 'https://example.test/recording');
      const context = await getContext.execute({ input: { userId: 'own-member' }, context: { user: sonia } } as never);
      assert.equal(context.userName, 'own-member');
    });
  });
}

test('facilitation scope never inherits department-wide admin access or unrelated supervision', async t => {
  const { sonia } = fixture(t);
  await withHierarchyDatabase(null, async () => {
    const adminRgf = { ...sonia, role: 'ADMIN', isBvAdmin: true };
    assert.deepEqual((await resolveBvScopedGroups(adminRgf, { segment: 'PW', facilitationOnly: true })).map(group => group.id), ['gauranga']);
    await assert.rejects(() => getData.execute({ input: { viewScope: 'supervisor' }, context: { user: { ...sonia, isBvSupervisor: false, isBvMentor: false } } } as never), /Supervisor access/);
  });
});
