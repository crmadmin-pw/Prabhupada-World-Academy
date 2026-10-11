import assert from 'node:assert/strict';
import test from 'node:test';

import getFolkSadhanaReport from '../src/api/getFolkSadhanaReport';
import getGuideAttendanceReport from '../src/api/getGuideAttendanceReport';
import getMissingSadhanaReport from '../src/api/getMissingSadhanaReport';
import getPipelineReport from '../src/api/getPipelineReport';
import getPreachingDataReport from '../src/api/getPreachingDataReport';
import getSuperGuideAttendanceReport from '../src/api/getSuperGuideAttendanceReport';
import {
  AttendanceRecords,
  BvAttendance,
  BvGroups,
  BvslPreachingEntries,
  FolkResidencies,
  OneToOneMeetings,
  SadhanaEntries,
  Users,
} from '../src/lib/app-backend-sdk';
import {
  deleteAllReportSummaries,
  folkScoreFromTotals,
  loadFolkTotals,
  mergeFolkTotals,
} from '../src/lib/reportPeriodSummary';

const DAY = '2026-08-12';
const NEXT_DAY = '2026-08-13';

function superContext() {
  return {
    user: {
      id: 'RPT-ADMIN',
      uid: 'RPT-ADMIN',
      email: 'rpt-admin@example.invalid',
      role: 'SUPER_ADMIN',
      isBvSuperAdmin: true,
      isBvAdmin: true,
    },
  };
}

function watch(table: { findAll: (query?: any) => Promise<any> }) {
  const original = table.findAll.bind(table);
  let scans = 0;
  table.findAll = async (query: any = {}) => {
    scans += 1;
    return original(query);
  };
  return {
    count: () => scans,
    reset: () => { scans = 0; },
    restore: () => { table.findAll = original; },
  };
}

async function remove(table: { delete: (input: { id: string }) => Promise<any> }, id: string) {
  await table.delete({ id }).catch(() => undefined);
}

test('missing submissions are stored once and a later entry write updates them without a report scan', async () => {
  const userId = 'RPT-MISS-USER';
  const entryId = 'RPT-MISS-ENTRY';
  await deleteAllReportSummaries();
  const scans = watch(SadhanaEntries);
  try {
    await Users.create({ record: {
      id: userId, userId: 'RPT-MISS', fullName: 'Report Missing User', email: 'rpt-miss@example.invalid',
      status: 'Active', role: 'User', segment: 'PW',
    } });
    await SadhanaEntries.create({ record: {
      id: entryId, user: userId, entryDate: DAY, submittedAt: `${DAY}T08:00:00.000Z`,
    } });
    scans.reset();
    const first = await getMissingSadhanaReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(first.matrix[userId][DAY], 'filled');
    assert.ok(scans.count() > 0);
    scans.reset();
    const second = await getMissingSadhanaReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(second.matrix[userId][DAY], 'filled');
    assert.equal(scans.count(), 0);
    await SadhanaEntries.update({ id: entryId, record: { submittedAt: `${NEXT_DAY}T08:00:00.000Z` } });
    scans.reset();
    const third = await getMissingSadhanaReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(third.matrix[userId][DAY], 'late');
    assert.equal(scans.count(), 0);
  } finally {
    scans.restore();
    await remove(SadhanaEntries, entryId);
    await remove(Users, userId);
    await deleteAllReportSummaries();
  }
});

test('folk averages come from merged period totals and stay current without another entry scan', async () => {
  const userId = 'RPT-FOLK-USER';
  const residencyId = 'RPT-FOLK-RES';
  const firstEntry = 'RPT-FOLK-ENTRY-1';
  const secondEntry = 'RPT-FOLK-ENTRY-2';
  await deleteAllReportSummaries();
  const scans = watch(SadhanaEntries);
  try {
    await FolkResidencies.create({ record: { id: residencyId, residencyName: 'FOLK Report', isActive: true } });
    await Users.create({ record: {
      id: userId, userId: 'RPT-FOLK', fullName: 'Folk Report User', email: 'rpt-folk@example.invalid',
      status: 'Active', role: 'User', residency: residencyId, residencyApproved: true,
    } });
    await SadhanaEntries.create({ record: {
      id: firstEntry, user: userId, entryDate: DAY, scorePercent: 80, totalScore: 16, maxScore: 20,
      roundsPoints: 4, roundsCount: 16,
    } });
    await SadhanaEntries.create({ record: {
      id: secondEntry, user: userId, entryDate: NEXT_DAY, scorePercent: 50, totalScore: 10, maxScore: 20,
      roundsPoints: 2, roundsCount: 8,
    } });
    scans.reset();
    const first = await getFolkSadhanaReport.execute({
      input: { date: DAY, startDate: DAY, endDate: NEXT_DAY }, context: superContext(),
    } as any);
    assert.ok(scans.count() > 0);
    const row = first.folkRows.find((item: any) => item.residencyId === residencyId);
    assert.equal(row.displayAvgs.rounds, 3);
    assert.equal(row.avgScore, 65);
    scans.reset();
    const left = (await loadFolkTotals(DAY, DAY)).get(userId.toLowerCase());
    const right = (await loadFolkTotals(NEXT_DAY, NEXT_DAY)).get(userId.toLowerCase());
    assert.ok(left && right);
    const merged = folkScoreFromTotals(mergeFolkTotals(left, right));
    assert.equal(merged.roundsPoints, row.displayAvgs.rounds);
    assert.equal(merged.scorePercent, row.avgScore);
    assert.equal(scans.count(), 0);
    const second = await getFolkSadhanaReport.execute({
      input: { date: DAY, startDate: DAY, endDate: NEXT_DAY }, context: superContext(),
    } as any);
    assert.equal(second.folkRows.find((item: any) => item.residencyId === residencyId).displayAvgs.rounds, 3);
    assert.equal(scans.count(), 0);
    await SadhanaEntries.update({ id: secondEntry, record: { roundsPoints: 4 } });
    scans.reset();
    const third = await getFolkSadhanaReport.execute({
      input: { date: DAY, startDate: DAY, endDate: NEXT_DAY }, context: superContext(),
    } as any);
    assert.equal(third.folkRows.find((item: any) => item.residencyId === residencyId).displayAvgs.rounds, 4);
    assert.equal(scans.count(), 0);
  } finally {
    scans.restore();
    await remove(SadhanaEntries, firstEntry);
    await remove(SadhanaEntries, secondEntry);
    await remove(Users, userId);
    await remove(FolkResidencies, residencyId);
    await deleteAllReportSummaries();
  }
});

test('pipeline chanting for the current month is reused and refreshed from the entry write', async () => {
  const userId = 'RPT-PIPE-USER';
  const entryId = 'RPT-PIPE-ENTRY';
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = `${month}-10`;
  await deleteAllReportSummaries();
  const sadhana = watch(SadhanaEntries);
  const meetings = watch(OneToOneMeetings);
  const preaching = watch(BvslPreachingEntries);
  try {
    await Users.create({ record: {
      id: userId, userId: 'RPT-PIPE', fullName: 'Pipeline Report User', email: 'rpt-pipe@example.invalid',
      status: 'Active', role: 'User', ashrayLevel: 'Shraddhavan',
    } });
    await SadhanaEntries.create({ record: {
      id: entryId, user: userId, entryDate: day, templateMode: 'RESIDENT', roundsCount: 16,
    } });
    sadhana.reset();
    meetings.reset();
    preaching.reset();
    const context = { user: { ...superContext().user, role: 'Super Guide' } };
    const first = await getPipelineReport.execute({ input: {}, context } as any);
    const member = first.sections.flatMap((section: any) => section.members).find((item: any) => item.id === userId);
    assert.equal(member.monthlyData[month].chanting, 16);
    assert.ok(sadhana.count() > 0);
    sadhana.reset();
    meetings.reset();
    preaching.reset();
    const second = await getPipelineReport.execute({ input: {}, context } as any);
    assert.equal(second.sections.flatMap((section: any) => section.members).find((item: any) => item.id === userId).monthlyData[month].chanting, 16);
    assert.equal(sadhana.count(), 0);
    assert.equal(meetings.count(), 0);
    assert.equal(preaching.count(), 0);
    await SadhanaEntries.update({ id: entryId, record: { roundsCount: 12 } });
    sadhana.reset();
    const third = await getPipelineReport.execute({ input: {}, context } as any);
    assert.equal(third.sections.flatMap((section: any) => section.members).find((item: any) => item.id === userId).monthlyData[month].chanting, 12);
    assert.equal(sadhana.count(), 0);
  } finally {
    sadhana.restore();
    meetings.restore();
    preaching.restore();
    await remove(SadhanaEntries, entryId);
    await remove(Users, userId);
    await deleteAllReportSummaries();
  }
});

test('preaching books accumulate from the stored days and a write updates that total without a source scan', async () => {
  const userId = 'RPT-PREACH-USER';
  const residencyId = 'RPT-PREACH-RES';
  const entryId = 'RPT-PREACH-ENTRY';
  await deleteAllReportSummaries();
  const users = watch(Users);
  const sadhana = watch(SadhanaEntries);
  const preaching = watch(BvslPreachingEntries);
  const attendance = watch(BvAttendance);
  const groups = watch(BvGroups);
  const booksOf = (result: any) => result.metrics.find((metric: any) => metric.key === 'Books Distributed')
    .rows.find((row: any) => row.centerId === residencyId).cumulative;
  try {
    await FolkResidencies.create({ record: { id: residencyId, residencyName: 'FOLK Preaching', isActive: true } });
    await Users.create({ record: {
      id: userId, userId: 'RPT-PREACH', fullName: 'Preaching Report User', email: 'rpt-preach@example.invalid',
      status: 'Active', role: 'User', residency: residencyId, residencyApproved: true, isB: true,
    } });
    await BvslPreachingEntries.create({ record: {
      id: entryId, user: userId, entryDate: DAY, prBooksDistributed: 5,
    } });
    users.reset();
    sadhana.reset();
    preaching.reset();
    attendance.reset();
    groups.reset();
    const first = await getPreachingDataReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(booksOf(first), 5);
    assert.ok(users.count() > 0 && sadhana.count() > 0 && preaching.count() > 0 && attendance.count() > 0 && groups.count() > 0);
    users.reset();
    sadhana.reset();
    preaching.reset();
    attendance.reset();
    groups.reset();
    const second = await getPreachingDataReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(booksOf(second), 5);
    assert.equal(users.count() + sadhana.count() + preaching.count() + attendance.count() + groups.count(), 0);
    await BvslPreachingEntries.update({ id: entryId, record: { prBooksDistributed: 9 } });
    users.reset();
    sadhana.reset();
    preaching.reset();
    attendance.reset();
    groups.reset();
    const third = await getPreachingDataReport.execute({ input: { startDate: DAY, endDate: DAY }, context: superContext() } as any);
    assert.equal(booksOf(third), 9);
    assert.equal(users.count() + sadhana.count() + preaching.count() + attendance.count() + groups.count(), 0);
  } finally {
    users.restore();
    sadhana.restore();
    preaching.restore();
    attendance.restore();
    groups.restore();
    await remove(BvslPreachingEntries, entryId);
    await remove(Users, userId);
    await remove(FolkResidencies, residencyId);
    await deleteAllReportSummaries();
  }
});

test('guide and super attendance reuse stored windows and show the written row', async () => {
  const userId = 'RPT-ATT-USER';
  const groupId = 'RPT-ATT-GROUP';
  const stdId = 'RPT-ATT-STD';
  const bvId = 'RPT-ATT-BV';
  await deleteAllReportSummaries();
  const standard = watch(AttendanceRecords);
  const bv = watch(BvAttendance);
  try {
    await Users.create({ record: {
      id: userId, userId: 'RPT-ATT', fullName: 'Attendance Report User', email: 'rpt-att@example.invalid',
      status: 'Active', role: 'User', segment: 'PW',
    } });
    await BvGroups.create({ record: {
      id: groupId, groupId: 'RPT-ATT-GROUP-PUBLIC', groupName: 'Report Group', segment: 'PW', isActive: true,
    } });
    await AttendanceRecords.create({ record: {
      id: stdId, user: userId, date: DAY, session: 'RPT-SESSION', source: 'manual',
    } });
    await BvAttendance.create({ record: {
      id: bvId, group: groupId, user: 'RPT-ATT', attendanceDate: DAY, present: true, sessionTopic: 'Weekly BV Reading',
    } });
    standard.reset();
    bv.reset();
    const guideInput = { startDate: DAY, endDate: DAY };
    const guideFirst = await getGuideAttendanceReport.execute({ input: guideInput, context: superContext() } as any);
    assert.equal(guideFirst.records.find((row: any) => row.id === stdId)?.source, 'manual');
    assert.ok(standard.count() > 0);
    standard.reset();
    const guideSecond = await getGuideAttendanceReport.execute({ input: guideInput, context: superContext() } as any);
    assert.equal(guideSecond.records.find((row: any) => row.id === stdId)?.source, 'manual');
    assert.equal(standard.count(), 0);
    const superInput = { segment: 'PW', startDate: DAY, endDate: DAY };
    const superFirst = await getSuperGuideAttendanceReport.execute({ input: superInput, context: superContext() } as any);
    assert.equal(superFirst.records.find((row: any) => row.id === bvId)?.sessionName, 'Weekly BV Reading');
    assert.ok(bv.count() > 0);
    assert.equal(standard.count(), 0);
    standard.reset();
    bv.reset();
    const superSecond = await getSuperGuideAttendanceReport.execute({ input: superInput, context: superContext() } as any);
    assert.equal(superSecond.records.find((row: any) => row.id === bvId)?.source, 'Bhakti Vriksha');
    assert.equal(standard.count(), 0);
    assert.equal(bv.count(), 0);
    await AttendanceRecords.update({ id: stdId, record: { source: 'kiosk' } });
    await BvAttendance.update({ id: bvId, record: { sessionTopic: 'Revised Reading' } });
    standard.reset();
    bv.reset();
    const guideThird = await getGuideAttendanceReport.execute({ input: guideInput, context: superContext() } as any);
    const superThird = await getSuperGuideAttendanceReport.execute({ input: superInput, context: superContext() } as any);
    assert.equal(guideThird.records.find((row: any) => row.id === stdId)?.source, 'kiosk');
    assert.equal(superThird.records.find((row: any) => row.id === bvId)?.sessionName, 'Revised Reading');
    assert.equal(standard.count(), 0);
    assert.equal(bv.count(), 0);
  } finally {
    standard.restore();
    bv.restore();
    await remove(AttendanceRecords, stdId);
    await remove(BvAttendance, bvId);
    await remove(BvGroups, groupId);
    await remove(Users, userId);
    await deleteAllReportSummaries();
  }
});
