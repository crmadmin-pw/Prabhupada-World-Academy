import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, Guides, FolkResidencies, SadhanaEntries, BvGroups, BvGroupMembers } from '../src/lib/app-backend-sdk';
import * as sdk from '../src/lib/app-backend-sdk';
import { getSadhanaMentorResidencyScope } from '../src/lib/sadhanaMentorResidencyScope';
import detailed from '../src/api/getGuideDetailedReport';
import missing from '../src/api/getMissingSadhanaReport';
import members from '../src/api/getMentorMembers';
import stats from '../src/api/getSadhanaStats';
import entryDetail from '../src/api/getEntryDetail';
import userDetail from '../src/api/getUserDetailForGuide';
import leaderboard from '../src/api/getSadhanaLeaderboard';
import folkReport from '../src/api/getFolkSadhanaReport';
import oneToOneContext from '../src/api/getOneToOneContext';

const mentor = { id: 'mentor', userId: 'USER-M', fullName: 'Mentor', email: 'mentor@example.test', status: 'Active', role: 'Sadhana Mentor', isSadhanaMentor: true, segment: 'FOLK', guide: 'guide-a', residency: 'powai', sadhanaMentorResidencyIds: ['powai'] };
const centers = [{ id: 'powai', residencyId: 'RES-1', residencyName: 'FOLK Powai', isActive: true }, { id: 'vashi', residencyId: 'RES-2', residencyName: 'FOLK Vashi', isActive: true }];
const member = (id: string, extra: any = {}) => ({ id, userId: `USER-${id}`, fullName: id, email: `${id}@example.test`, role: 'User', status: 'Active', segment: 'FOLK', residency: 'powai', guide: 'guide-b', residencyApproved: false, ...extra });
const rows = [mentor, member('other-guide'), member('legacy-residency', { residency: ['FOLK Powai'] }), member('vashi', { residency: 'vashi', guide: 'guide-a' }), member('pw', { segment: 'PW' }), member('inactive', { status: 'Inactive' }), member('admin', { role: 'Super Admin' }), member('guide', { role: 'Guide' }), member('blank', { fullName: '' })];

function mockTables(t: any, users = rows, guides = [{ id: 'guide-a', fullName: 'Guide A', folkResidencies: ['powai', 'vashi'] }] as any[], residencies = centers as any[], entries = [] as any[]) {
  const fixtures: Record<string, any[]> = { Users: users, Guides: guides, FolkResidencies: residencies, SadhanaEntries: entries };
  const matches = (record: any, filters: any) => Object.entries(filters).every(([key, value]: any) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [record[key]].flat().some(actual => value.in.includes(actual));
      return (value.gte === undefined || record[key] >= value.gte) && (value.lte === undefined || record[key] <= value.lte);
    }
    return [record[key]].flat().includes(value);
  });
  // Every database table is mocked, including automatically built report
  // summaries. These authorization tests cannot touch a live database.
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const records = fixtures[name] || [];
    t.mock.method(table, 'findAll', async ({ filters = {}, fields, offset = 0, limit = 2000 }: any = {}) => {
      const filtered = records.filter((r: any) => matches(r, filters));
      const page = filtered.slice(offset, offset + limit);
      return { records: fields ? page.map((r: any) => Object.fromEntries(['id', ...fields].filter(k => k in r).map(k => [k, r[k]]))) : page, hasMore: offset + limit < filtered.length };
    });
    t.mock.method(table, 'findOne', async ({ id, filters = {} }: any) => records.find((r: any) => id ? r.id === id : matches(r, filters)));
    t.mock.method(table, 'create', async ({ record }: any) => { records.push(record); return record; });
    t.mock.method(table, 'update', async ({ id, record }: any) => { const existing = records.find(r => r.id === id); Object.assign(existing || {}, record); return existing; });
  }
}

test('FOLK mentor scope includes Powai boys across guides, but excludes the same guide’s Vashi boys', async t => {
  mockTables(t);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor', 'other-guide', 'legacy-residency']);
  assert.equal(scope.includes(member('foreign', { residency: 'vashi', guide: 'unrelated-guide' })), false);
});

test('detailed, missing and member reports use identical residency scope despite hostile guide/segment selectors', async t => {
  mockTables(t);
  const context = { user: mentor };
  const d = await detailed.execute({ input: { guideId: 'ALL', mentorMode: true, date: '2026-10-02', reportType: 'daily', segment: 'FOLK' }, context } as any);
  const m = await missing.execute({ input: { guideId: 'guide-b', residencyId: 'vashi', startDate: '2026-10-02', endDate: '2026-10-02', segment: 'FOLK' }, context } as any);
  const list = await members.execute({ input: {}, context } as any);
  assert.deepEqual(d.users.map((r: any) => r.id).sort(), ['legacy-residency', 'mentor', 'other-guide']);
  assert.equal(d.users.find((r: any) => r.id === 'vashi'), undefined);
  assert.equal(d.users.find((r: any) => r.id === 'other-guide')?.residencyName, 'FOLK Powai');
  assert.deepEqual(m.users.map((r: any) => r.id).sort(), ['legacy-residency', 'mentor', 'other-guide']);
  assert.deepEqual(list.members.map((r: any) => r.userId).sort(), ['USER-legacy-residency', 'USER-other-guide']);
  assert.equal(m.stats.totalUsers, 3);
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


test('unknown hostel assignment grants no member access even through a linked guide', async t => {
  mockTables(t, [{ ...mentor, residency: null, sadhanaMentorResidencyIds: ['missing-residency'] }, ...rows.slice(1)]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor']);
});

test('a mentor’s own hostel is authoritative even without legacy residency grants', async t => {
  mockTables(t, [{ ...mentor, sadhanaMentorResidencyIds: undefined }]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(r => r.id), ['mentor', 'other-guide', 'legacy-residency']);
});

test('moving a mentor to Vashi revokes Powai access despite stale Powai grants and the same parent guide', async t => {
  const moved = { ...mentor, residency: 'vashi', sadhanaMentorResidencyIds: ['powai'] };
  mockTables(t, [moved, ...rows.slice(1)]);
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.deepEqual(rows.filter(scope.includes).map(user => user.id), ['mentor', 'vashi']);
  assert.deepEqual(scope.residencies.map(residency => residency.id), ['vashi']);
});

test('guide public IDs, emails and Users aliases resolve to the same parent', async t => {
  mockTables(t);
  t.mock.method(Guides, 'findAll', async () => ({ records: [{ id: 'guide-a', guideId: 'GUIDE-A', email: 'guide@example.test' }], hasMore: false }));
  const scope = await getSadhanaMentorResidencyScope(mentor);
  assert.ok(scope);
  assert.equal(scope.includes(member('alias', { residency: 'vashi', guide: ['GUIDE-A'] })), false);
  assert.equal(scope.includes(member('alias-email', { residency: null, guide: 'guide@example.test' })), false);
  assert.equal(scope.includes(member('alias-powai', { residency: 'powai', guide: ['GUIDE-A'] })), true);
});

function powaiFixture() {
  const guideUsers = ['sreesha', 'aditya', 'manmohan', 'mathuranath', 'foreign'].map(id => ({
    ...member(id), role: 'Guide', folkResidencies: ['powai'],
  }));
  const guides = guideUsers.map(user => ({ ...user, id: `guide-${user.id}`, guideId: `GUIDE-${user.id}`, isActive: true }));
  const mentorUser = { ...mentor, guide: ['GUIDE-sreesha'], sadhanaMentorResidencyIds: undefined };
  const boys = [
    member('own-boy', { guide: 'guide-sreesha', residency: 'powai' }),
    member('same-guide-vashi-boy', { guide: 'guide-sreesha', residency: 'vashi' }),
    member('aditya-boy', { guide: ['USER-aditya'], residency: 'powai' }),
    member('manmohan-boy', { guide: 'manmohan@example.test', residency: 'powai' }),
    member('mathuranath-boy', { guide: 'guide-mathuranath', residency: 'powai' }),
    member('hostel-resident', { guide: 'guide-foreign', residency: 'RES-1' }),
    member('visiting-boy', { guide: 'guide-foreign', residency: null, temporaryResidency: 'powai', temporaryResidencyEnabled: true }),
    member('foreign-boy', { guide: 'guide-foreign', residency: 'vashi' }),
    member('pw-boy', { guide: 'guide-aditya', segment: 'PW' }),
    member('inactive-boy', { guide: 'guide-aditya', status: 'Inactive' }),
  ];
  const residencies = [
    { ...centers[0], guideIds: ['guide-sreesha', 'guide-aditya', 'guide-manmohan', 'guide-mathuranath'] },
    { ...centers[1], guideIds: ['guide-foreign'] },
  ];
  return { mentorUser, guideUsers, guides, boys, residencies, users: [mentorUser, ...guideUsers, ...boys] };
}

const powaiBoyIds = ['aditya-boy', 'hostel-resident', 'manmohan-boy', 'mathuranath-boy', 'own-boy'];

test('a FOLK mentor sees all boys whose center is Powai, not Vashi boys under the same guide', async t => {
  const fixture = powaiFixture();
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const scope = await getSadhanaMentorResidencyScope({ ...fixture.mentorUser, guide: 'guide-foreign' });
  assert.ok(scope);
  assert.deepEqual(fixture.boys.filter(scope.includes).map(user => user.id).sort(), powaiBoyIds);
  assert.deepEqual(scope.residencies.map(r => r.id), ['powai']);
  assert.deepEqual(scope.availableGuides.map(g => g.guideId), ['guide-aditya', 'guide-manmohan', 'guide-mathuranath', 'guide-sreesha']);
});

test('report, missing report, member list and statistics share the assigned hostel audience', async t => {
  const fixture = powaiFixture();
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const context = { user: fixture.mentorUser };
  const report = await detailed.execute({ input: { guideId: 'guide-foreign', mentorMode: true, date: '2026-10-22', reportType: 'daily', segment: 'FOLK' }, context } as any);
  const missingReport = await missing.execute({ input: { guideId: 'ALL', startDate: '2026-10-22', endDate: '2026-10-22', segment: 'FOLK' }, context } as any);
  const memberList = await members.execute({ input: {}, context } as any);
  const statistics = await stats.execute({ input: { guideId: 'guide-foreign', mentorMode: true, startDate: '2026-10-22', endDate: '2026-10-22', segment: 'FOLK' }, context } as any);
  const expected = ['mentor', ...powaiBoyIds].sort();
  assert.deepEqual(report.users.map((user: any) => user.id).sort(), expected);
  assert.deepEqual(missingReport.users.map((user: any) => user.id).sort(), expected);
  assert.deepEqual(memberList.members.map((user: any) => user.userId).sort(), powaiBoyIds.map(id => `USER-${id}`).sort());
  assert.equal(statistics.totalUsers, expected.length);
  assert.deepEqual(statistics.userSummaries.map((user: any) => user.fullName).sort(), ['Mentor', ...powaiBoyIds].sort());
  assert.deepEqual(missingReport.guides.map((guide: any) => guide.id).sort(), report.availableGuides.map((guide: any) => guide.guideId).sort());
  assert.equal(missingReport.users.find((user: any) => user.id === 'aditya-boy')?.guideName, 'aditya');
});

test('a mentor can narrow reports to a peer guide, while a foreign guide selector grants nothing', async t => {
  const fixture = powaiFixture();
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const context = { user: fixture.mentorUser };
  for (const filterGuideId of ['guide-aditya', 'guide-foreign']) {
    const report = await detailed.execute({ input: { guideId: 'ALL', filterGuideId, mentorMode: true, date: '2026-10-22', reportType: 'daily', segment: 'FOLK' }, context } as any);
    const missingReport = await missing.execute({ input: { filterGuideId, startDate: '2026-10-22', endDate: '2026-10-22', segment: 'FOLK' }, context } as any);
    const expected = filterGuideId === 'guide-aditya' ? ['aditya-boy'] : [];
    assert.deepEqual(report.users.map((user: any) => user.id), expected);
    assert.deepEqual(missingReport.users.map((user: any) => user.id), expected);
  }
});

test('report entry details permit peer-guide boys and reject boys outside the inherited hostel', async t => {
  const fixture = powaiFixture();
  const entries = ['aditya-boy', 'same-guide-vashi-boy', 'foreign-boy', 'pw-boy'].map(id => ({ id: `entry-${id}`, entryId: `ENTRY-${id}`, user: id, entryDate: '2026-10-22', fieldValuesJson: JSON.stringify({ chanting: 16 }) }));
  mockTables(t, fixture.users, fixture.guides, fixture.residencies, entries);
  const context = { user: fixture.mentorUser };
  const byEntryId = await entryDetail.execute({ input: { entryId: 'ENTRY-aditya-boy' }, context } as any);
  const byUserId = await entryDetail.execute({ input: { userId: 'USER-aditya-boy', entryDate: '2026-10-22' }, context } as any);
  assert.equal(byEntryId.found, true);
  assert.equal(byUserId.found, true);
  for (const id of ['same-guide-vashi-boy', 'foreign-boy', 'pw-boy']) {
    await assert.rejects(entryDetail.execute({ input: { entryId: `ENTRY-${id}` }, context } as any), /outside your FOLK hostel/);
  }
});

test('current hostel assignments override stale guide links and revoked mentors lose inherited access', async t => {
  const fixture = powaiFixture();
  fixture.residencies[0].guideIds = [];
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const scope = await getSadhanaMentorResidencyScope(fixture.mentorUser);
  assert.ok(scope);
  assert.deepEqual(fixture.boys.filter(scope.includes).map(user => user.id).sort(), powaiBoyIds);
  fixture.mentorUser.isSadhanaMentor = false;
  const revoked = await getSadhanaMentorResidencyScope({ ...fixture.mentorUser, isSadhanaMentor: true });
  assert.ok(revoked);
  assert.equal(fixture.boys.some(revoked.includes), false);
});

test('a member beyond the first two thousand records remains visible through inherited hostel access', async t => {
  const fixture = powaiFixture();
  const foreign = Array.from({ length: 2100 }, (_, index) => member(`foreign-${index}`, { guide: 'guide-foreign', residency: 'vashi' }));
  mockTables(t, [fixture.mentorUser, ...fixture.guideUsers, ...foreign, fixture.boys.find(user => user.id === 'aditya-boy')], fixture.guides, fixture.residencies);
  const result = await members.execute({ input: {}, context: { user: fixture.mentorUser } } as any);
  assert.deepEqual(result.members.map((user: any) => user.userId), ['USER-aditya-boy']);
});

test('a mentor can open a peer-guide member’s Sadhana profile but cannot open another center’s member', async t => {
  const fixture = powaiFixture();
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const context = { user: fixture.mentorUser };
  const profile = await userDetail.execute({ input: { userId: 'USER-aditya-boy' }, context } as any);
  assert.equal(profile.user.dbId, 'aditya-boy');
  for (const id of ['same-guide-vashi-boy', 'foreign-boy']) {
    await assert.rejects(userDetail.execute({ input: { userId: `USER-${id}` }, context } as any), /outside your FOLK hostel/);
  }
});

test('one-to-one Sadhana context cannot reveal a Vashi boy under the same guide', async t => {
  const fixture = powaiFixture();
  mockTables(t, fixture.users, fixture.guides, fixture.residencies);
  const context = { user: fixture.mentorUser };
  const powai = await oneToOneContext.execute({ input: { userId: 'USER-aditya-boy' }, context } as any);
  assert.ok(powai);
  await assert.rejects(oneToOneContext.execute({ input: { userId: 'USER-same-guide-vashi-boy' }, context } as any), /FOLK hostel/);
});

test('Sadhana and hostel leaderboards use the same mentor audience as the report', async t => {
  const fixture = powaiFixture();
  Object.assign(fixture.boys.find(user => user.id === 'aditya-boy')!, { residencyApproved: true });
  Object.assign(fixture.boys.find(user => user.id === 'foreign-boy')!, { residencyApproved: true });
  const date = '2026-10-21';
  const entries = fixture.boys.map(user => ({ id: `entry-${user.id}`, user: user.id, entryDate: date, scorePercent: 90, totalScore: 18, maxScore: 20, templateMode: 'RESIDENT_TEMPLATE', fieldValuesJson: '{}' }));
  mockTables(t, fixture.users, fixture.guides, fixture.residencies, entries);
  const context = { user: fixture.mentorUser };
  const ranking = await leaderboard.execute({ input: { date, guideId: 'guide-foreign', segment: 'FOLK' }, context } as any);
  assert.deepEqual(ranking.leaderboard.map((user: any) => user.userId).sort(), powaiBoyIds.map(id => `USER-${id}`).sort());
  const hostels = await folkReport.execute({ input: { date, guideId: 'guide-foreign', segment: 'FOLK' }, context } as any);
  assert.deepEqual(hostels.folkRows.map((row: any) => row.residencyId), ['powai']);
  assert.equal(hostels.folkRows[0].total, 1);
});
