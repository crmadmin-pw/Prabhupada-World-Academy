import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import sessionMatrix from '../src/api/getBvSessionMatrix';
import groupMatrix from '../src/api/getBvAttendanceMatrix';
import { withHierarchyDatabase } from '../src/lib/hierarchyUtils';
import { withRequestQueries } from '../src/lib/requestQueries';
import { serverCacheInvalidate } from '../src/lib/serverCache';

for (const asStaff of [false, true]) {
  test(`PW transferred ${asStaff ? 'RGSF/admin' : 'member'} keeps former-group attendance in both reports`, async t => {
    const admin = { id: 'super', userId: 'SUPER', role: 'User', segment: 'PW', isBvSuperAdmin: true, isBvAdmin: true };
    const member = { id: 'member-doc', userId: 'MEMBER', email: 'member@example.invalid', firebaseUid: 'member-auth',
      fullName: 'Transferred Member', status: 'Active', role: asStaff ? 'Admin' : 'User', segment: 'PW',
      isBvAdmin: asStaff, isBvSubFacilitator: asStaff, isBvMember: true, bvGroupId: 'new-group' };
    const peer = { id: 'peer-doc', userId: 'PEER', fullName: 'Peer', status: 'Active', role: 'User', segment: 'PW' };
    const group = { id: 'new-group', groupId: 'NEW-GROUP', groupName: 'Destination', segment: 'PW', isActive: true,
      ...(asStaff ? { subFacilitatorId: member.id, rgsfId: member.userId, subFacilitator: member.fullName } : {}) };
    const mark = (id: string, user: any, group: string, attendanceDate: string, present: boolean) => ({ id, user, group, attendanceDate, present });
    const fixtures: Record<string, any[]> = {
      Users: [admin, member, peer], BvGroups: [group],
      BvGroupMembers: [
        { id: 'member-membership', user: member.id, userId: member.userId, group: group.id, groupId: group.groupId, joinedAt: '2026-11-02T08:45:39Z' },
        { id: 'peer-membership', user: peer.id, userId: peer.userId, group: group.id, groupId: group.groupId },
      ],
      BvAttendance: [
        mark('old-27', member.userId, 'old-group', '2026-10-27', true),
        mark('backfilled-27', member.id, group.id, '2026-10-27', false),
        mark('old-28', [member.firebaseUid], 'old-group', '2026-10-28', true),
        mark('peer-28', peer.id, group.id, '2026-10-28', true),
        mark('old-only-sunday', member.id, 'old-group', '2026-11-01', true),
        mark('old-04', member.id, 'old-group', '2026-11-04', true),
        mark('absent-04', member.id, group.id, '2026-11-04', false),
        mark('old-05', member.id, 'old-group', '2026-11-05', true),
        mark('peer-05', peer.id, group.id, '2026-11-05', true),
        mark('present-06', member.firebaseUid, group.id, '2026-11-06', true),
        mark('outside-peer', 'private-member', 'old-group', '2026-10-30', true),
        mark('outside-range', member.id, 'old-group', '2026-09-01', true),
        mark('sadhana-only', member.id, '', '2026-10-29', true),
      ],
    };
    void serverCacheInvalidate(undefined, { publish: false });
    for (const [name, table] of Object.entries(sdk) as [string, any][]) {
      if (typeof table?.findAll !== 'function') continue;
      const query = (options: any = {}) => {
        const records = (fixtures[name] || []).filter(row => (!options.id || row.id === options.id) &&
          Object.entries(options.filters || {}).every(([field, value]: any) => {
            const actual = row[field];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              if (value.in) return value.in.some((item: any) => JSON.stringify(item) === JSON.stringify(actual));
              return (!value.gte || actual >= value.gte) && (!value.lte || actual <= value.lte);
            }
            return JSON.stringify(actual) === JSON.stringify(value);
          }));
        return { records: records.map(row => options.fields ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, row[key]])) : { ...row }), hasMore: false };
      };
      t.mock.method(table, 'findAll', async (options: any) => query(options));
      t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
      for (const method of ['create', 'update', 'delete']) t.mock.method(table, method, async () => { throw new Error('Reports must not write'); });
    }
    const range = { startDate: '2026-10-26', endDate: '2026-11-06' };
    const run = (endpoint: any, input: any) => withHierarchyDatabase(null, async () =>
      (await withRequestQueries(() => endpoint.execute({ input, context: { user: admin } }))).result as any);
    const sessions = await run(sessionMatrix, { guideId: 'ALL', segment: 'PW', groupId: group.id, ...range });
    assert.equal(sessions.attendance[member.id]['2026-10-27'], true);
    assert.equal(sessions.attendance[member.id]['2026-10-28'], true);
    assert.equal(sessions.attendance[member.id]['2026-11-04'], false);
    assert.equal(sessions.attendance[member.id]['2026-11-05'], false);
    assert.equal(sessions.attendance[member.id]['2026-11-06'], true);
    assert.equal(sessions.attendance['private-member'], undefined);
    assert.ok(!sessions.sessionDates.includes('2026-10-29'));
    assert.ok(!sessions.sessionDates.includes('2026-09-01'));
    const details = await run(groupMatrix, { groupId: group.id, ...range });
    const row = details.rows.find((row: any) => row.userId === member.userId);
    assert.ok(row);
    assert.equal(row.attendance['2026-10-27'], 1);
    assert.equal(row.attendance['2026-10-28'], 1);
    assert.equal(row.attendance['2026-11-04'], 0);
    assert.equal(row.attendance['2026-11-05'], 0);
    assert.equal(row.attendance['2026-11-06'], 1);
    assert.equal(row.attendance['2026-11-01'], 1);
    assert.equal(details.rows.find((row: any) => row.userId === peer.userId)?.attendance['2026-11-01'], undefined);
    assert.ok(!details.dates.includes('2026-10-30'));
  });
}
