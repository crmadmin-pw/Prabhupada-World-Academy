import assert from 'node:assert/strict';
import test from 'node:test';

import getBvPreachingReport from '../src/api/getBvPreachingReport';
import getBvSessionMatrix from '../src/api/getBvSessionMatrix';
import getBvStats from '../src/api/getBvStats';
import getGuideDetailedReport from '../src/api/getGuideDetailedReport';
import getGuideGroupStats from '../src/api/getGuideGroupStats';
import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import getSadhanaStats from '../src/api/getSadhanaStats';
import { BvAttendance, BvGroupMembers, BvGroups, BvslPreachingEntries, SadhanaEntries, Users } from '../src/lib/app-backend-sdk';

test('PW Admin BV reports return only data in that admin hierarchy across every report tab', async () => {
  const date = '2026-09-08';
  const admin = {
    id: 'PW-ADMIN-REPORT-DB', userId: 'PW-ADMIN-REPORT', email: 'pw-admin-report@example.invalid',
    fullName: 'PW Report Admin', role: 'Admin', status: 'Active', segment: 'PW', isBvAdmin: true,
  };
  const pwRgf = {
    id: 'PW-ADMIN-REPORT-RGF-DB', userId: 'PW-ADMIN-REPORT-RGF', email: 'pw-report-rgf@example.invalid',
    fullName: 'PW Report RGF', role: 'User', status: 'Active', segment: 'PW', isBvsl: true, isBvFacilitator: true,
    bvReportingAdminId: admin.id, guide: admin.id,
  };
  const pwMember = {
    id: 'PW-ADMIN-REPORT-MEMBER-DB', userId: 'PW-ADMIN-REPORT-MEMBER', email: 'pw-report-member@example.invalid',
    fullName: 'PW Report Member', role: 'User', status: 'Active', segment: 'PW', ashrayLevel: 'Sevak',
  };
  const folkRgf = {
    id: 'PW-ADMIN-REPORT-FOLK-RGF-DB', userId: 'PW-ADMIN-REPORT-FOLK-RGF', email: 'folk-report-rgf@example.invalid',
    fullName: 'FOLK Report RGF', role: 'User', status: 'Active', segment: 'FOLK', isBvsl: true, isBvFacilitator: true,
  };
  const folkMember = {
    id: 'PW-ADMIN-REPORT-FOLK-MEMBER-DB', userId: 'PW-ADMIN-REPORT-FOLK-MEMBER', email: 'folk-report-member@example.invalid',
    fullName: 'FOLK Report Member', role: 'User', status: 'Active', segment: 'FOLK', ashrayLevel: 'Sevak',
  };
  const pwGroup = {
    id: 'PW-ADMIN-REPORT-GROUP-DB', groupId: 'PW-ADMIN-REPORT-GROUP', groupName: 'PW Report Group',
    segment: 'Prabhupada World', isActive: true, bvslLeader: pwRgf.userId, guide: admin.id,
  };
  const folkGroup = {
    id: 'PW-ADMIN-REPORT-FOLK-GROUP-DB', groupId: 'PW-ADMIN-REPORT-FOLK-GROUP', groupName: 'FOLK Report Group',
    segment: 'FOLK', isActive: true, bvslLeader: folkRgf.id,
  };
  const records = {
    pwMembership: 'PW-ADMIN-REPORT-MEMBERSHIP', folkMembership: 'PW-ADMIN-REPORT-FOLK-MEMBERSHIP',
    pwAttendance: 'PW-ADMIN-REPORT-ATTENDANCE', folkAttendance: 'PW-ADMIN-REPORT-FOLK-ATTENDANCE',
    pwPreaching: 'PW-ADMIN-REPORT-PREACHING', folkPreaching: 'PW-ADMIN-REPORT-FOLK-PREACHING',
    pwSadhana: 'PW-ADMIN-REPORT-SADHANA', folkSadhana: 'PW-ADMIN-REPORT-FOLK-SADHANA',
  };
  const context = { user: admin };

  try {
    for (const user of [admin, pwRgf, pwMember, folkRgf, folkMember]) await Users.create({ record: user });
    await BvGroups.create({ record: pwGroup });
    await BvGroups.create({ record: folkGroup });
    await BvGroupMembers.create({ record: { id: records.pwMembership, group: pwGroup.groupId, memberId: pwMember.email, role: 'Member' } });
    await BvGroupMembers.create({ record: { id: records.folkMembership, group: folkGroup.id, user: folkMember.id, role: 'Member' } });
    await BvAttendance.create({ record: { id: records.pwAttendance, group: pwGroup.id, user: pwMember.userId, attendanceDate: date, present: true } });
    await BvAttendance.create({ record: { id: records.folkAttendance, group: folkGroup.id, user: folkMember.id, attendanceDate: date, present: true } });
    await BvslPreachingEntries.create({ record: { id: records.pwPreaching, user: pwRgf.email, entryDate: date, totalPreachingMinutes: 90, prCallingTime: 30 } });
    await BvslPreachingEntries.create({ record: { id: records.folkPreaching, user: folkRgf.id, entryDate: date, totalPreachingMinutes: 120, prCallingTime: 40 } });
    await SadhanaEntries.create({ record: {
      id: records.pwSadhana, user: pwRgf.email, entryDate: date, totalScore: 16, maxScore: 20, scorePercent: 80,
      fieldValuesJson: JSON.stringify({
        chanting: 8, reading: 30, hearing: 20, seva: 15,
        _meta: {
          pwVersion: 2,
          scorePercent: 50,
          pwFields: { wakeUp: 4, sleep: 2, chanting: 8, reading: 4, hearing: 6, submitted: 2, seva: 4, bvAttendance: 10 },
        },
      }),
    } });
    await SadhanaEntries.create({ record: { id: records.folkSadhana, user: folkMember.id, entryDate: date, totalScore: 18, maxScore: 20, scorePercent: 90 } });

    const matrix = await getBvSessionMatrix.execute({ input: { guideId: admin.userId, segment: 'PW', startDate: date, endDate: date }, context } as never);
    assert.deepEqual(matrix.groups.map((group: any) => group.id), [pwGroup.id]);
    assert.deepEqual(matrix.members.map((member: any) => member.fullName), [pwMember.fullName, pwRgf.fullName]);
    assert.equal(matrix.attendance[pwMember.id]?.[date], true);

    const preaching = await getBvPreachingReport.execute({ input: { guideId: admin.userId, segment: 'PW', date, reportType: 'daily' }, context } as never);
    assert.deepEqual(preaching.bvsls.map((row: any) => row.fullName), [pwRgf.fullName]);
    assert.equal(preaching.bvsls[0].totalMinutes, 90);

    const stats = await getBvStats.execute({ input: { guideId: admin.userId, segment: 'PW', startDate: date, endDate: date }, context } as never);
    assert.deepEqual(stats.userSummaries.map((row: any) => row.fullName), [pwRgf.fullName]);
    assert.equal(stats.totalSubmitted, 1);

    const groups = await getGuideGroupStats.execute({ input: { guideId: admin.userId, segment: 'PW' }, context } as never);
    assert.deepEqual(groups.groups.map((group: any) => group.groupName), [pwGroup.groupName]);
    assert.equal(groups.groups[0].memberCount, 2);
    assert.equal(groups.groups[0].attendanceRate, 50);

    const sadhana = await getGuideDetailedReport.execute({ input: { guideId: admin.userId, segment: 'PW', date, reportType: 'daily', facilitatorMode: true }, context } as never);
    assert.ok(sadhana.users.some((user: any) => user.fullName === pwRgf.fullName));
    assert.ok(!sadhana.users.some((user: any) => user.fullName === folkMember.fullName));

    const sadhanaStats = await getSadhanaStats.execute({ input: { guideId: admin.userId, segment: 'PW', startDate: date, endDate: date, facilitatorMode: true }, context } as never);
    assert.ok(sadhanaStats.userSummaries.some((user: any) => user.fullName === pwRgf.fullName));
    const trend = sadhanaStats.dailyTrend.find((point: any) => point.date === date);
    assert.equal(trend?.pwWakeUpPts, 4);
    assert.equal(trend?.pwSleepPts, 2);
    assert.equal(trend?.pwHearingPts, 6);
    assert.equal(trend?.pwSevaPts, 4);
    assert.equal(trend?.pwSubmittedPts, 2);
    assert.equal(trend?.pwAttendancePts, 10);
    assert.equal(trend?.rounds, 8);
    assert.equal(trend?.reading, 30);
    assert.ok(!sadhanaStats.userSummaries.some((user: any) => user.fullName === folkMember.fullName));

    const leaderboard = await getSadhanaLeaderboard.execute({ input: { guideId: admin.userId, segment: 'PW', date, facilitatorMode: true }, context } as never);
    assert.ok(leaderboard.leaderboard.some((user: any) => user.displayName === pwRgf.fullName));
    assert.ok(!leaderboard.leaderboard.some((user: any) => user.displayName === folkMember.fullName));
  } finally {
    for (const id of Object.values(records)) {
      await BvGroupMembers.delete({ id }).catch(() => undefined);
      await BvAttendance.delete({ id }).catch(() => undefined);
      await BvslPreachingEntries.delete({ id }).catch(() => undefined);
      await SadhanaEntries.delete({ id }).catch(() => undefined);
    }
    await BvGroups.delete({ id: pwGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: folkGroup.id }).catch(() => undefined);
    for (const user of [admin, pwRgf, pwMember, folkRgf, folkMember]) await Users.delete({ id: user.id }).catch(() => undefined);
  }
});
