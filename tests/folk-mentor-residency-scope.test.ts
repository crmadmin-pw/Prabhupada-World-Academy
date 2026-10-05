import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, Guides, FolkResidencies, SadhanaEntries, BvGroups, BvGroupMembers } from '../src/lib/app-backend-sdk';
import { getSadhanaMentorResidencyScope } from '../src/lib/sadhanaMentorResidencyScope';
import detailed from '../src/api/getGuideDetailedReport';
import missing from '../src/api/getMissingSadhanaReport';
import members from '../src/api/getMentorMembers';

const mentor = { id: 'mentor', userId: 'USER-M', fullName: 'Mentor', email: 'mentor@example.test', status: 'Active', role: 'Sadhana Mentor', isSadhanaMentor: true, segment: 'FOLK', guide: 'guide-a', residency: 'powai', sadhanaMentorResidencyIds: ['powai'] };
const centers = [{ id: 'powai', residencyId: 'RES-1', residencyName: 'FOLK Powai', isActive: true }, { id: 'vashi', residencyId: 'RES-2', residencyName: 'FOLK Vashi', isActive: true }];
const member = (id: string, extra: any = {}) => ({ id, userId: `USER-${id}`, fullName: id, email: `${id}@example.test`, role: 'User', status: 'Active', segment: 'FOLK', residency: 'powai', guide: 'guide-b', residencyApproved: false, ...extra });
const rows = [mentor, member('other-guide'), member('legacy-residency', { residency: ['FOLK Powai'] }), member('vashi', { residency: 'vashi', guide: 'guide-a' }), member('pw', { segment: 'PW' }), member('inactive', { status: 'Inactive' }), member('admin', { role: 'Super Admin' }), member('guide', { role: 'Guide' }), member('blank', { fullName: '' })];

function mockTables(t: any, users = rows) {
  for (const [table, records] of [[Users, users], [Guides, [{ id: 'guide-a', fullName: 'Guide A', folkResidencies: ['powai', 'vashi'] }]], [FolkResidencies, centers], [SadhanaEntries, []], [BvGroups, []], [BvGroupMembers, []]] as any[]) {
    t.mock.method(table, 'findAll', async ({ filters = {}, fields, offset = 0, limit = 2000 }: any = {}) => {
      const filtered = records.filter((r: any) => Object.entries(filters).every(([k, v]) => r[k] === v));
      const page = filtered.slice(offset, offset + limit);
      return { records: fields ? page.map((r: any) => Object.fromEntries(['id', ...fields].filter(k => k in r).map(k => [k, r[k]]))) : page, hasMore: offset + limit < filtered.length };
    });
    t.mock.method(table, 'findOne', async ({ id, filters = {} }: any) => records.find((r: any) => id ? r.id === id : Object.entries(filters).every(([k, v]) => r[k] === v)));
  }
}

test('FOLK mentor scope includes self, residency members and linked guide members, excluding PW and leadership', async t => {
  mockTables(t);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor', 'other-guide', 'legacy-residency', 'vashi']);
  assert.equal(scope.includes(member('foreign', { residency: 'vashi', guide: 'unrelated-guide' })), false);
});

test('detailed, missing and member reports use identical residency scope despite hostile guide/segment selectors', async t => {
  mockTables(t);
  const context = { user: mentor };
  const d = await detailed.execute({ input: { guideId: 'ALL', mentorMode: true, date: '2026-10-02', reportType: 'daily', segment: 'FOLK' }, context } as any);
  const m = await missing.execute({ input: { guideId: 'guide-b', residencyId: 'vashi', startDate: '2026-10-02', endDate: '2026-10-02', segment: 'FOLK' }, context } as any);
  const list = await members.execute({ input: {}, context } as any);
  assert.deepEqual(d.users.map((r: any) => r.id).sort(), ['legacy-residency', 'mentor', 'other-guide', 'vashi']);
  assert.equal(d.users.find((r: any) => r.id === 'vashi').residencyName, 'FOLK Vashi');
  assert.equal(d.users.find((r: any) => r.id === 'other-guide').residencyName, 'FOLK Powai');
  assert.deepEqual(m.users.map((r: any) => r.id).sort(), ['legacy-residency', 'mentor', 'other-guide', 'vashi']);
  assert.deepEqual(list.members.map((r: any) => r.userId).sort(), ['USER-legacy-residency', 'USER-other-guide', 'USER-vashi']);
  assert.equal(m.stats.totalUsers, 4);
  assert.deepEqual(d.availableResidencies.map((r: any) => r.residencyId), ['powai']);
});

test('revocation fails closed', async t => {
  mockTables(t, [{ ...mentor, isSadhanaMentor: false }, ...rows.slice(1)]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.equal(rows.filter(scope.includes).length, 0);
});

test('PW mentors retain existing access paths', async t => {
  mockTables(t, [{ ...mentor, segment: 'PW' }]);
  assert.equal(await getSadhanaMentorResidencyScope(mentor), null);
});


test('unknown residency grants add no foreign members; the linked guide and self still remain visible', async t => {
  mockTables(t, [{ ...mentor, sadhanaMentorResidencyIds: ['missing-residency'] }, ...rows.slice(1)]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor', 'vashi']);
});

test('FOLK mentors without residency grants can see their own row and their guide members', async t => {
  mockTables(t, [{ ...mentor, sadhanaMentorResidencyIds: undefined }]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor', 'vashi']);
});

test('guide public IDs, emails and Users aliases resolve to the same parent', async t => {
  mockTables(t);
  t.mock.method(Guides, 'findAll', async () => ({ records: [{ id: 'guide-a', guideId: 'GUIDE-A', email: 'guide@example.test' }], hasMore: false }));
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.equal(scope.includes(member('alias', { residency: 'vashi', guide: ['GUIDE-A'] })), true);
  assert.equal(scope.includes(member('alias-email', { residency: null, guide: 'guide@example.test' })), true);
});
