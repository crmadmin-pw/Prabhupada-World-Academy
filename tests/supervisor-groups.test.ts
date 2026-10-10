import assert from 'node:assert/strict';
import test from 'node:test';

import getBvAttendanceMatrix from '../src/api/getBvAttendanceMatrix';
import getBvGroupDetail from '../src/api/getBvGroupDetail';
import getBvPreachingReport from '../src/api/getBvPreachingReport';
import getBvSessionMatrix from '../src/api/getBvSessionMatrix';
import getBvStats from '../src/api/getBvStats';
import getBvSupervisorOverview from '../src/api/getBvSupervisorOverview';
import getBvslGroups from '../src/api/getBvslGroups';
import getGuideGroupStats from '../src/api/getGuideGroupStats';
import getGuideDetailedReport from '../src/api/getGuideDetailedReport';
import getSadhanaLeaderboard from '../src/api/getSadhanaLeaderboard';
import getSadhanaStats from '../src/api/getSadhanaStats';
import { BvAttendance, BvGroupMembers, BvGroups, BvQuizzes, BvslPreachingEntries, SadhanaEntries, Users } from '../src/lib/app-backend-sdk';
import { isBvSuperAdminUser, resolveBvGroupMemberUsers, resolveBvScopedGroups } from '../src/lib/bvGroupMemberScope';
import { getTodayIST } from '../src/lib/streakUtils';

const supervisor = {
  id: 'SUPERVISOR-GROUPS-DB',
  userId: 'SUPERVISOR-GROUPS',
  email: 'supervisor-groups@example.invalid',
  fullName: 'Supervisor Groups',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
  isBvSupervisor: true,
};

const reportingRgf = {
  id: 'SUPERVISOR-GROUPS-RGF-DB',
  userId: 'SUPERVISOR-GROUPS-RGF',
  email: 'supervisor-groups-rgf@example.invalid',
  fullName: 'Reporting RGF',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
  isBvFacilitator: true,
  isBvsl: true,
  bvReportingSupervisorId: supervisor.id,
};

const assignedRgsf = {
  id: 'SUPERVISOR-GROUPS-RGSF-DB',
  userId: 'SUPERVISOR-GROUPS-RGSF',
  email: 'supervisor-groups-rgsf@example.invalid',
  fullName: 'Assigned RGSF',
  role: 'RGSF',
  status: 'Active',
  segment: 'FOLK',
  isBvSubFacilitator: true,
  bvReportingFacilitatorId: reportingRgf.id,
};

const outsideRgf = {
  id: 'SUPERVISOR-GROUPS-OUTSIDE-RGF-DB',
  userId: 'SUPERVISOR-GROUPS-OUTSIDE-RGF',
  email: 'supervisor-groups-outside-rgf@example.invalid',
  fullName: 'Outside RGF',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
  isBvFacilitator: true,
  bvReportingSupervisorId: 'SOME-OTHER-SUPERVISOR',
};

const member = {
  id: 'SUPERVISOR-GROUPS-MEMBER-DB',
  userId: 'SUPERVISOR-GROUPS-MEMBER',
  email: 'supervisor-groups-member@example.invalid',
  fullName: 'Group Member',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
};

const outsideMember = {
  id: 'SUPERVISOR-GROUPS-OUTSIDE-MEMBER-DB',
  userId: 'SUPERVISOR-GROUPS-OUTSIDE-MEMBER',
  email: 'supervisor-groups-outside-member@example.invalid',
  fullName: 'Outside Group Member',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
};

const supervisedGroup = {
  id: 'SUPERVISOR-GROUPS-GROUP-DB',
  groupId: 'SUPERVISOR-GROUPS-GROUP',
  groupName: 'Supervised Reading Group',
  description: 'Visible to the reporting supervisor',
  bvslId: reportingRgf.userId,
  bvslName: reportingRgf.fullName,
  segment: 'FOLK',
  isActive: true,
};

const outsideGroup = {
  id: 'SUPERVISOR-GROUPS-OUTSIDE-GROUP-DB',
  groupId: 'SUPERVISOR-GROUPS-OUTSIDE-GROUP',
  groupName: 'Outside Reading Group',
  bvslId: outsideRgf.userId,
  bvslName: outsideRgf.fullName,
  segment: 'FOLK',
  isActive: true,
};

test('supervisor groups include only groups led by reporting RGFs with RGF card metrics', async () => {
  const users = [supervisor, reportingRgf, assignedRgsf, outsideRgf, member, outsideMember];
  const groups = [supervisedGroup, outsideGroup];
  const membershipId = 'SUPERVISOR-GROUPS-MEMBERSHIP';
  const outsideMembershipId = 'SUPERVISOR-GROUPS-OUTSIDE-MEMBERSHIP';
  const attendanceId = 'SUPERVISOR-GROUPS-ATTENDANCE';
  const quizId = 'SUPERVISOR-GROUPS-QUIZ';
  const memberEntryId = 'SUPERVISOR-GROUPS-SADHANA';
  const outsideEntryId = 'SUPERVISOR-GROUPS-OUTSIDE-SADHANA';
  const preachingEntryId = 'SUPERVISOR-GROUPS-PREACHING';
  const rgfSelfMembershipId = 'SUPERVISOR-GROUPS-RGF-SELF-MEMBERSHIP';
  const memberPreachingEntryId = 'SUPERVISOR-GROUPS-MEMBER-PREACHING';
  const today = getTodayIST();

  for (const user of users) await Users.create({ record: user });
  for (const group of groups) await BvGroups.create({ record: group });
  await BvGroupMembers.create({
    record: {
      id: membershipId,
      group: supervisedGroup.id,
      groupId: supervisedGroup.groupId,
      user: member.id,
      userId: member.userId,
      role: 'Member',
    },
  });
  await BvGroupMembers.create({
    record: {
      id: outsideMembershipId,
      group: outsideGroup.id,
      groupId: outsideGroup.groupId,
      user: outsideMember.id,
      userId: outsideMember.userId,
      role: 'Member',
    },
  });
  await BvAttendance.create({
    record: {
      id: attendanceId,
      group: supervisedGroup.id,
      user: member.id,
      attendanceDate: today,
      present: true,
    },
  });
  await BvQuizzes.create({
    record: {
      id: quizId,
      quizId,
      quizTitle: 'Supervised Group Quiz',
      group: supervisedGroup.id,
      groupId: supervisedGroup.groupId,
      department: 'FOLK',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  });
  await SadhanaEntries.create({
    record: {
      id: memberEntryId,
      user: member.id,
      entryDate: today,
      totalScore: 17,
      maxScore: 20,
      scorePercent: 85,
      preachingMinutes: 135,
      booksDistributed: 4,
      templateMode: 'NON_RESIDENT',
      fieldValuesJson: '{}',
      submittedAt: `${today}T05:00:00.000Z`,
    },
  });
  await BvslPreachingEntries.create({
    record: {
      id: preachingEntryId,
      user: reportingRgf.userId,
      entryDate: today,
      prCallingTime: 30,
      prOneOnOneTime: 20,
      prBookDistTime: 10,
      prRduaTime: 5,
      prPlanTime: 5,
      prBooksDistributed: 2,
      prContactsCollected: 3,
      prUniqueOneOnOnes: 1,
      totalPreachingMinutes: 70,
      submittedAt: `${today}T06:00:00.000Z`,
    },
  });
  await SadhanaEntries.create({
    record: {
      id: outsideEntryId,
      user: outsideMember.id,
      entryDate: today,
      totalScore: 20,
      maxScore: 20,
      scorePercent: 100,
      templateMode: 'NON_RESIDENT',
      fieldValuesJson: '{}',
      submittedAt: `${today}T04:00:00.000Z`,
    },
  });

  try {
    // Legacy FOLK supervisors may not have a segment stored yet. The FOLK
    // supervisor dashboard must still resolve their reporting RGFs.
    const result = await getBvSupervisorOverview.execute({
      input: {},
      context: { user: { ...supervisor, segment: undefined } },
    } as never);

    assert.deepEqual(result.groups.map((group: any) => group.groupId), [supervisedGroup.groupId]);
    assert.equal(result.rgfCount, 1);
    assert.equal(result.groups[0].memberCount, 1);
    assert.equal(result.groups[0].totalSessions, 1);
    assert.equal(result.groups[0].presentToday, 1);
    assert.equal(result.groups[0].description, supervisedGroup.description);

    const detail = await getBvGroupDetail.execute({
      input: { groupId: supervisedGroup.groupId },
      context: { user: supervisor },
    } as never);
    assert.equal(detail.group.groupName, supervisedGroup.groupName);
    assert.equal(detail.members.length, 1);
    assert.equal(detail.quizzes.length, 1);

    const matrix = await getBvAttendanceMatrix.execute({
      input: { groupId: supervisedGroup.groupId, startDate: getTodayIST(), endDate: getTodayIST() },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(matrix.dates, [getTodayIST()]);
    assert.equal(matrix.rows[0].weekTotal, 1);

    const reportMatrix = await getBvSessionMatrix.execute({
      input: {
        guideId: supervisor.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(reportMatrix.groups.map((group: any) => group.id), [supervisedGroup.id]);
    assert.deepEqual(reportMatrix.members.map((row: any) => row.fullName), [member.fullName]);
    assert.deepEqual(reportMatrix.sessionDates, [today]);
    assert.equal(reportMatrix.attendance[member.id]?.[today], true);

    const facilitatorReport = await getBvPreachingReport.execute({
      input: {
        guideId: supervisor.userId,
        date: today,
        reportType: 'daily',
        bvslMode: true,
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(facilitatorReport.bvsls.map((row: any) => row.fullName), [reportingRgf.fullName]);
    assert.equal(facilitatorReport.bvsls[0].submitted, true);
    assert.equal(facilitatorReport.bvsls[0].totalMinutes, 70);

    const improvementReport = await getBvPreachingReport.execute({
      input: {
        guideId: supervisor.userId,
        date: today,
        startDate: today,
        endDate: today,
        reportType: 'weekly',
        bvslMode: true,
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(improvementReport.bvsls.map((row: any) => row.fullName), [reportingRgf.fullName]);
    assert.equal(improvementReport.bvsls[0].submitted, true);
    assert.equal(improvementReport.bvsls[0].totalMinutes, 70);

    const preachingStats = await getBvStats.execute({
      input: {
        guideId: supervisor.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: supervisor },
    } as never);
    assert.equal(preachingStats.totalUsers, 1);
    assert.equal(preachingStats.totalSubmitted, 1);
    assert.deepEqual(preachingStats.userSummaries.map((row: any) => row.fullName), [reportingRgf.fullName]);

    const groupScopedPreachingStats = await getBvStats.execute({
      input: {
        guideId: supervisor.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
        groupId: supervisedGroup.groupId,
      },
      context: { user: supervisor },
    } as never);
    assert.equal(groupScopedPreachingStats.totalUsers, 1);
    assert.deepEqual(groupScopedPreachingStats.userSummaries.map((row: any) => row.fullName), [reportingRgf.fullName]);
    await assert.rejects(
      getBvStats.execute({
        input: {
          guideId: supervisor.userId,
          startDate: today,
          endDate: today,
          bvslMode: true,
          groupId: outsideGroup.groupId,
        },
        context: { user: supervisor },
      } as never),
      /not assigned to your hierarchy/,
    );

    const groupStats = await getGuideGroupStats.execute({
      input: { guideId: supervisor.userId, bvslMode: true },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(groupStats.groups.map((group: any) => group.groupName), [supervisedGroup.groupName]);
    assert.equal(groupStats.groups[0].memberCount, 1);

    const scopedGroups = await resolveBvScopedGroups(supervisor, { segment: 'FOLK' });
    assert.deepEqual(scopedGroups.map(group => group.groupId), [supervisedGroup.groupId]);

    const allScopedMembers = await resolveBvGroupMemberUsers(
      supervisor,
      ['id', 'userId', 'fullName', 'email'],
      { segment: 'FOLK' },
    );
    assert.deepEqual(allScopedMembers.map(user => user.id), [member.id]);

    const selectedGroupMembers = await resolveBvGroupMemberUsers(
      supervisor,
      ['id', 'userId', 'fullName', 'email'],
      { segment: 'FOLK', groupId: supervisedGroup.groupId },
    );
    assert.deepEqual(selectedGroupMembers.map(user => user.id), [member.id]);
    await assert.rejects(
      () => resolveBvGroupMemberUsers(supervisor, ['id'], { segment: 'FOLK', groupId: outsideGroup.id }),
      /not assigned to your hierarchy/,
    );

    const report = await getGuideDetailedReport.execute({
      input: {
        guideId: supervisor.userId,
        date: today,
        reportType: 'daily',
        bvslMode: true,
        groupId: supervisedGroup.id,
        segment: 'FOLK',
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(report.users.map((user: any) => user.fullName), [member.fullName]);

    const stats = await getSadhanaStats.execute({
      input: {
        guideId: supervisor.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
        groupId: supervisedGroup.groupId,
        segment: 'FOLK',
      },
      context: { user: supervisor },
    } as never);
    assert.equal(stats.totalUsers, 1);
    assert.equal(stats.userSummaries[0].fullName, member.fullName);

    const leaderboard = await getSadhanaLeaderboard.execute({
      input: {
        date: today,
        bvslMode: true,
        groupId: supervisedGroup.id,
      },
      context: { user: supervisor },
    } as never);
    assert.deepEqual(leaderboard.leaderboard.map((row: any) => row.displayName), [member.fullName]);

    await assert.rejects(
      () => getSadhanaLeaderboard.execute({
        input: {
          date: today,
          bvslMode: true,
          groupId: outsideGroup.id,
        },
        context: { user: supervisor },
      } as never),
      /not assigned to your hierarchy/,
    );

    // Even if a legacy membership row incorrectly includes the facilitator,
    // an RGF report must contain only members of the groups they facilitate.
    await BvGroupMembers.create({
      record: {
        id: rgfSelfMembershipId,
        group: supervisedGroup.id,
        groupId: supervisedGroup.groupId,
        user: reportingRgf.id,
        userId: reportingRgf.userId,
        role: 'Member',
      },
    });
    await BvslPreachingEntries.create({
      record: {
        id: memberPreachingEntryId,
        user: member.id,
        entryDate: today,
        prCallingTime: 20,
        prOneOnOneTime: 10,
        prBookDistTime: 5,
        prRduaTime: 5,
        prPlanTime: 5,
        prBooksDistributed: 1,
        prContactsCollected: 2,
        prUniqueOneOnOnes: 1,
        totalPreachingMinutes: 45,
        submittedAt: `${today}T07:00:00.000Z`,
      },
    });

    const rgfMatrix = await getBvSessionMatrix.execute({
      input: {
        guideId: reportingRgf.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: reportingRgf },
    } as never);
    assert.deepEqual(rgfMatrix.members.map((row: any) => row.fullName), [member.fullName]);
    assert.deepEqual(rgfMatrix.sessionDates, [today]);
    assert.equal(rgfMatrix.attendance[member.id]?.[today], true);

    const rgfPreachingReport = await getBvPreachingReport.execute({
      input: {
        guideId: reportingRgf.userId,
        date: today,
        reportType: 'daily',
        bvslMode: true,
      },
      context: { user: reportingRgf },
    } as never);
    assert.deepEqual(rgfPreachingReport.bvsls.map((row: any) => row.fullName), [member.fullName]);
    assert.equal((rgfPreachingReport as any).subjectType, 'members');
    assert.equal(rgfPreachingReport.bvsls[0].groupName, supervisedGroup.groupName);
    assert.equal(rgfPreachingReport.bvsls[0].totalMinutes, 135);
    assert.equal(rgfPreachingReport.bvsls[0].booksDistributed, 4);

    const rgfPreachingStats = await getBvStats.execute({
      input: {
        guideId: reportingRgf.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: reportingRgf },
    } as never);
    assert.deepEqual(rgfPreachingStats.userSummaries.map((row: any) => row.fullName), [member.fullName]);
    assert.equal((rgfPreachingStats as any).subjectType, 'members');
    assert.equal(rgfPreachingStats.totalSubmitted, 1);
    assert.equal(rgfPreachingStats.userSummaries[0].avgTotalPreachingMinutes, 135);
    assert.equal(rgfPreachingStats.dailyTrend[0].totalPreachingMinutes, 135);
    assert.equal(rgfPreachingStats.dailyTrend[0].prBooksDistributed, 4);

    // The RGSF must receive the exact same assigned-group member data as the
    // reporting RGF, never an empty report or data from an unrelated group.
    const rgsfGroups = await resolveBvScopedGroups(assignedRgsf as any, { segment: 'FOLK' });
    assert.deepEqual(rgsfGroups.map(group => group.id), [supervisedGroup.id]);
    const rgsfMembers = await resolveBvGroupMemberUsers(assignedRgsf as any, ['id', 'fullName'], { segment: 'FOLK', excludeCaller: true });
    assert.deepEqual(rgsfMembers.map(user => user.fullName), [member.fullName]);

    const rgsfMatrix = await getBvSessionMatrix.execute({
      input: {
        guideId: assignedRgsf.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: assignedRgsf },
    } as never);
    assert.deepEqual(rgsfMatrix.members.map((row: any) => row.fullName), [member.fullName]);
    assert.equal(rgsfMatrix.attendance[member.id]?.[today], true);

    const rgsfPreachingReport = await getBvPreachingReport.execute({
      input: {
        guideId: assignedRgsf.userId,
        date: today,
        reportType: 'daily',
        bvslMode: true,
      },
      context: { user: assignedRgsf },
    } as never);
    assert.equal((rgsfPreachingReport as any).subjectType, 'members');
    assert.deepEqual(rgsfPreachingReport.bvsls.map((row: any) => row.fullName), [member.fullName]);
    assert.equal(rgsfPreachingReport.bvsls[0].totalMinutes, 135);
    assert.equal(rgsfPreachingReport.bvsls[0].booksDistributed, 4);

    const rgsfPreachingStats = await getBvStats.execute({
      input: {
        guideId: assignedRgsf.userId,
        startDate: today,
        endDate: today,
        bvslMode: true,
      },
      context: { user: assignedRgsf },
    } as never);
    assert.equal((rgsfPreachingStats as any).subjectType, 'members');
    assert.deepEqual(rgsfPreachingStats.userSummaries.map((row: any) => row.fullName), [member.fullName]);
    assert.equal(rgsfPreachingStats.totalSubmitted, 1);
    assert.equal(rgsfPreachingStats.dailyTrend[0].totalPreachingMinutes, 135);

    const rgfSadhanaReport = await getGuideDetailedReport.execute({
      input: {
        guideId: reportingRgf.userId,
        date: today,
        reportType: 'daily',
        bvslMode: true,
        segment: 'FOLK',
      },
      context: { user: reportingRgf },
    } as never);
    assert.deepEqual(rgfSadhanaReport.users.map((row: any) => row.fullName), [member.fullName]);

    const rgfGroupStats = await getGuideGroupStats.execute({
      input: { guideId: reportingRgf.userId, bvslMode: true },
      context: { user: reportingRgf },
    } as never);
    assert.equal(rgfGroupStats.groups[0].memberCount, 1);
  } finally {
    await BvslPreachingEntries.delete({ id: memberPreachingEntryId });
    await BvslPreachingEntries.delete({ id: preachingEntryId });
    await SadhanaEntries.delete({ id: memberEntryId });
    await SadhanaEntries.delete({ id: outsideEntryId });
    await BvQuizzes.delete({ id: quizId });
    await BvAttendance.delete({ id: attendanceId });
    await BvGroupMembers.delete({ id: membershipId });
    await BvGroupMembers.delete({ id: outsideMembershipId });
    await BvGroupMembers.delete({ id: rgfSelfMembershipId });
    for (const group of groups) await BvGroups.delete({ id: group.id });
    for (const user of users) await Users.delete({ id: user.id });
  }
});

test('normal PW admins see only groups under their reporting RGFs', async () => {
  const admin = {
    id: 'PW-ADMIN-SCOPE-DB',
    userId: 'PW-ADMIN-SCOPE',
    email: 'pw-admin-scope@example.invalid',
    fullName: 'Scoped PW Admin',
    role: 'ADMIN',
    status: 'Active',
    segment: 'PW',
    isBvAdmin: true,
  };
  const assignedRgf = {
    id: 'PW-ADMIN-SCOPE-RGF-DB',
    userId: 'PW-ADMIN-SCOPE-RGF',
    email: 'pw-admin-scope-rgf@example.invalid',
    fullName: 'Assigned PW RGF',
    role: 'RGF',
    status: 'Active',
    segment: 'PW',
    isBvFacilitator: true,
    bvReportingAdminId: admin.id,
  };
  const unrelatedRgf = {
    id: 'PW-ADMIN-SCOPE-OTHER-RGF-DB',
    userId: 'PW-ADMIN-SCOPE-OTHER-RGF',
    email: 'pw-admin-scope-other-rgf@example.invalid',
    fullName: 'Unrelated PW RGF',
    role: 'RGF',
    status: 'Active',
    segment: 'PW',
    isBvFacilitator: true,
    bvReportingAdminId: 'ANOTHER-PW-ADMIN',
  };
  const assignedGroup = {
    id: 'PW-ADMIN-SCOPE-GROUP-DB',
    groupId: 'PW-ADMIN-SCOPE-GROUP',
    groupName: 'Admin Assigned Group',
    bvslId: assignedRgf.userId,
    segment: 'PW',
    isActive: true,
  };
  const unrelatedGroup = {
    id: 'PW-ADMIN-SCOPE-OTHER-GROUP-DB',
    groupId: 'PW-ADMIN-SCOPE-OTHER-GROUP',
    groupName: 'Another Admin Group',
    bvslId: unrelatedRgf.userId,
    segment: 'PW',
    isActive: true,
  };

  try {
    await Users.create({ record: admin });
    await Users.create({ record: assignedRgf });
    await Users.create({ record: unrelatedRgf });
    await BvGroups.create({ record: assignedGroup });
    await BvGroups.create({ record: unrelatedGroup });

    const groups = await resolveBvScopedGroups(admin, { segment: 'PW' });
    assert.deepEqual(groups.map(group => group.id), [assignedGroup.id]);
    const reportGroups = await getGuideGroupStats.execute({
      input: { guideId: admin.userId, segment: 'PW' },
      context: { user: admin },
    } as never);
    assert.deepEqual(reportGroups.groups.map((group: any) => group.groupId), [assignedGroup.groupId]);
    await assert.rejects(
      () => getGuideGroupStats.execute({
        input: { guideId: 'ALL', segment: 'PW' },
        context: { user: admin },
      } as never),
      /super admin access/,
    );
    assert.equal(isBvSuperAdminUser(admin), false);
    assert.equal(isBvSuperAdminUser({ role: 'SUPER_ADMIN' }), true);
  } finally {
    await BvGroups.delete({ id: assignedGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: unrelatedGroup.id }).catch(() => undefined);
    await Users.delete({ id: admin.id }).catch(() => undefined);
    await Users.delete({ id: assignedRgf.id }).catch(() => undefined);
    await Users.delete({ id: unrelatedRgf.id }).catch(() => undefined);
  }
});

test('BV group detail resolves a legacy memberId membership for the group leader only', async () => {
  const leader = {
    id: 'BV-GROUP-DETAIL-LEGACY-LEADER-DOC',
    userId: 'BV-GROUP-DETAIL-LEGACY-LEADER',
    email: 'bv-group-detail-legacy-leader@example.invalid',
    fullName: 'Legacy Detail Leader',
    status: 'Active',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const group = {
    id: 'BV-GROUP-DETAIL-LEGACY-DOC',
    groupId: 'BV-GROUP-DETAIL-LEGACY',
    groupName: 'Legacy Detail Group',
    isActive: true,
    bvslId: leader.userId,
    bvslLeader: leader.id,
    joinToken: 'legacy-join-token',
  };
  const member = {
    id: 'BV-GROUP-DETAIL-LEGACY-USER-DOC',
    userId: 'BV-GROUP-DETAIL-LEGACY-USER',
    email: 'bv-group-detail-legacy@example.invalid',
    fullName: 'Legacy Detail Member',
    status: 'Active',
    role: 'User',
  };
  const membershipId = 'BV-GROUP-DETAIL-LEGACY-MEMBERSHIP';

  try {
    await Users.create({ record: leader });
    await Users.create({ record: member });
    await BvGroups.create({ record: group });
    await BvGroupMembers.create({
      record: { id: membershipId, group: group.groupId, memberId: member.email, role: 'Member' },
    });

    const detail = await getBvGroupDetail.execute({
      input: { groupId: group.groupId },
      context: { user: leader },
    } as never);

    assert.equal(detail.members.length, 1);
    assert.equal(detail.members[0].fullName, member.fullName);
    assert.equal(detail.members[0].userId, member.userId);
    assert.equal(detail.group.joinToken, group.joinToken);

    await assert.rejects(
      getBvGroupDetail.execute({
        input: { groupId: group.groupId },
        context: { user: member },
      } as never),
      (error: any) => error.code === 'FORBIDDEN',
    );
  } finally {
    await BvGroupMembers.delete({ id: membershipId }).catch(() => undefined);
    await BvGroups.delete({ id: group.id }).catch(() => undefined);
    await Users.delete({ id: member.id }).catch(() => undefined);
    await Users.delete({ id: leader.id }).catch(() => undefined);
  }
});

test('BV group cards count only current active members and update after a removal', async () => {
  const group = {
    id: 'BV-GROUP-CARD-COUNT-DOC',
    groupId: 'BV-GROUP-CARD-COUNT',
    groupName: 'Card Count Group',
    isActive: true,
  };
  const currentMember = {
    id: 'BV-GROUP-CARD-COUNT-CURRENT-DOC',
    userId: 'BV-GROUP-CARD-COUNT-CURRENT',
    email: 'bv-group-card-current@example.invalid',
    fullName: 'Current Card Member',
    status: 'Active',
    isBvMember: true,
    bvGroupId: group.id,
  };
  const removedMember = {
    id: 'BV-GROUP-CARD-COUNT-REMOVED-DOC',
    userId: 'BV-GROUP-CARD-COUNT-REMOVED',
    fullName: 'Removed Card Member',
    status: 'Active',
    isBvMember: false,
    bvGroupId: '',
  };
  const currentMembershipId = 'BV-GROUP-CARD-COUNT-CURRENT-MEMBERSHIP';
  const staleMembershipId = 'BV-GROUP-CARD-COUNT-STALE-MEMBERSHIP';

  try {
    await Users.create({ record: currentMember });
    await Users.create({ record: removedMember });
    await BvGroups.create({ record: group });
    await BvGroupMembers.create({
      record: { id: currentMembershipId, group: group.groupId, memberId: currentMember.email },
    });
    await BvGroupMembers.create({
      record: { id: staleMembershipId, groupId: group.id, user: removedMember.id },
    });

    const initial = await getBvslGroups.execute({ input: { bvslId: 'ALL' }, context: { user: { role: 'SUPER_ADMIN' } } } as never);
    assert.equal(initial.groups.find((item: any) => item.id === group.id)?.memberCount, 1);

    await BvGroupMembers.delete({ id: currentMembershipId });
    const afterRemoval = await getBvslGroups.execute({ input: { bvslId: 'ALL' }, context: { user: { role: 'SUPER_ADMIN' } } } as never);
    assert.equal(afterRemoval.groups.find((item: any) => item.id === group.id)?.memberCount, 0);
  } finally {
    await BvGroupMembers.delete({ id: currentMembershipId }).catch(() => undefined);
    await BvGroupMembers.delete({ id: staleMembershipId }).catch(() => undefined);
    await BvGroups.delete({ id: group.id }).catch(() => undefined);
    await Users.delete({ id: currentMember.id }).catch(() => undefined);
    await Users.delete({ id: removedMember.id }).catch(() => undefined);
  }
});
