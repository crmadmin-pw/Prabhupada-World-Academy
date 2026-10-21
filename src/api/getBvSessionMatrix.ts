import { z } from 'zod';
import { getScopedHierarchyUserIds, isPwDepartmentAdmin, isUserInHierarchy } from '../lib/hierarchyUtils';
import { createEndpoint, AppError, Users, BvGroups, BvGroupMembers, BvAttendance, BvQuizzes, BvQuizSubmissions, FolkResidencies } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideIdsForResidencies } from '../lib/guideScope';
import { legacyQuizMatchesGroup, normalizeQuizDepartment } from '../lib/bvQuizAccess';
import { bvGroupFacilitatorAliases, bvUserAliases, isBvDepartmentAdmin, isBvSuperAdminUser, isBvSupervisorUser, resolveBvDepartmentGroups, resolveBvScopedGroups, resolveBvUsersByAliases } from '../lib/bvGroupMemberScope';
import { findAllByIn } from '../lib/scopedEntryReads';
import { mergeReportAttendance } from '../lib/bvReportAttendance';

export default createEndpoint({
  description: 'BV attendance matrix with FOLK-only quiz results',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    groupId: z.string().optional(),
    bvslMode: z.boolean().optional(),
    residencyIds: z.array(z.string()).optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
    supervisionOnly: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: context.user.isBvMentor,
      isBvSupervisor: context.user.isBvSupervisor,
      isBvAdmin: context.user.isBvAdmin,
      isBvSuperAdmin: context.user.isBvSuperAdmin,
      isBvSubFacilitator: context.user.isBvSubFacilitator,
    });

    const { guideId, startDate, endDate, groupId, bvslMode, residencyIds, segment } = input;
    // Caller-only scope checks overlap the group and member reads; both are
    // still applied below exactly as before.
    const hierarchyPromise = getScopedHierarchyUserIds(context.user);
    void hierarchyPromise.catch(() => {});
    const permittedGroupsPromise = isBvSuperAdminUser(context.user as any)
      ? null
      : resolveBvScopedGroups(context.user as any, { segment, supervisionOnly: input.supervisionOnly === true });
    void permittedGroupsPromise?.catch(() => {});

    // Get groups
    const groupFilter: any = { isActive: true };
    if (bvslMode) {
      // Scope below by both the caller and (for an RGSF) their reporting RGF.
      // Group records use mixed identity fields, so a simple bvslLeader filter
      // would omit valid parent-RGF groups.
    } else if (residencyIds && residencyIds.length > 0) {
      // Center-based scoping: get all guides in these residencies
      const allGuideIds = await getGuideIdsForResidencies(residencyIds);
      if (allGuideIds.length > 0) {
        groupFilter.guide = { in: allGuideIds };
      } else {
        groupFilter.guide = guideId;
      }
    } else if (guideId !== 'ALL') {
      groupFilter.guide = guideId;
    }
    if (groupId) groupFilter.id = groupId;

    let groups: any[];
    if (guideId === 'ALL' && segment && isBvSuperAdminUser(context.user as any)) {
      if (!isBvSuperAdminUser(context.user as any)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Department-wide BV reports require super admin access' });
      }
      groups = (await resolveBvDepartmentGroups(segment, groupId)).map(group => group.record);
    } else if (isBvDepartmentAdmin(context.user as any) && !isBvSuperAdminUser(context.user as any)) {
      groups = (await resolveBvScopedGroups(context.user as any, { segment, groupId, supervisionOnly: input.supervisionOnly === true }))
        .map(group => group.record);
    } else if (bvslMode) {
      const rawSegment = String(context.user.segment || (context.user.isBvSupervisor ? 'FOLK' : '')).toUpperCase();
      const segment = rawSegment === 'FOLK' || rawSegment === 'PW' ? rawSegment as 'FOLK' | 'PW' : undefined;
      const scopedGroups = await resolveBvScopedGroups(context.user as any, { segment, groupId, supervisionOnly: input.supervisionOnly === true });
      groups = scopedGroups.map(group => group.record);
    } else {
      const result = await BvGroups.findAll({
        filters: groupFilter,
        fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId'],
        limit: 200,
      });
      groups = result.records;
    }

    if (groups.length === 0) {
      return { members: [], allDates: [], sessionDates: [], groups: [], attendance: {}, quizScores: {} };
    }

    // Older PW documents mix the Firestore record id and public groupId in
    // memberships and attendance. Treat both as aliases of the same group.
    if (permittedGroupsPromise) {
      const permitted = new Set((await permittedGroupsPromise).map(g => g.id));
      groups = groups.filter(group => permitted.has(group.id));
    }
    const groupIds = [...new Set(groups.flatMap(g => [g.id, g.groupId]).filter(Boolean))] as string[];
    const groupNameMap = new Map<string, string>();
    const groupCanonicalId = new Map<string, string>();
    for (const group of groups) {
      const canonical = String(group.id);
      for (const reference of [group.id, group.groupId].filter(Boolean)) {
        const key = String(reference);
        groupNameMap.set(key, (group.groupName || '') as string);
        groupCanonicalId.set(key, canonical);
      }
    }

    // Get all members for these groups
    const [membersByGroup, membersByGroupId] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { group: { in: groupIds } } as any,
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
        limit: 2000,
      }),
      BvGroupMembers.findAll({
        filters: { groupId: { in: groupIds } } as any,
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
        limit: 2000,
      }),
    ]);
    const memberships = [...membersByGroup.records, ...membersByGroupId.records]
      .filter((member: any, index: number, records: any[]) => records.findIndex(item => item.id === member.id) === index);

    const memberUserIds = [
      ...new Set([
        ...memberships
          .map(m => (Array.isArray(m.user) ? m.user[0] : (m.user || (m as any).userId || (m as any).memberId)) as string)
          .filter(Boolean),
        ...groups.flatMap(group => bvGroupFacilitatorAliases(group)),
      ]),
    ];

    if (memberUserIds.length === 0) {
      return {
        members: [],
        allDates: [],
        sessionDates: [],
        groups: groups.map(g => ({ id: g.id, name: g.groupName || '' })),
        attendance: {},
        quizScores: {},
      };
    }

    // Once group membership is authorized, profile labels, attendance and quiz
    // results can load independently. Keep legacy aliases and date filters intact.
    const [{ users, residencyNameMap }, allAttendance, quizScoreMap] = await Promise.all([
      (async () => {
        // Get user details
        const users = await resolveBvUsersByAliases(memberUserIds,
          ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved']);
        // Build residency name map
        const userResidencyIds = new Set<string>();
        for (const u of users) {
          const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency;
          if (rid && u.residencyApproved) userResidencyIds.add(rid as string);
        }
        const residencyNameMap = new Map<string, string>();
        if (userResidencyIds.size > 0) {
          const { records: resRecs } = await FolkResidencies.findAll({
            filters: { id: { in: Array.from(userResidencyIds) } } as any,
            fields: ['id', 'residencyName'],
            limit: 100,
          });
          for (const r of resRecs) residencyNameMap.set(r.id, ((r as any).residencyName || '').replace(/^FOLK\s+/i, 'FOLK '));
        }

        return { users, residencyNameMap };
      })(),
      (async () => {
        // Query attendance by group+date range directly (new approach)
        let allAttendance: any[] = [];
        if (groupIds.length > 0) {
          const loadAttendance = (field: 'group' | 'groupId') => findAllByIn(
            query => BvAttendance.findAll(query),
            field,
            groupIds,
            { attendanceDate: { gte: startDate, lte: endDate } },
            ['id', 'group', 'groupId', 'user', 'present', 'attendanceDate'],
          );
          const [byGroup, byGroupId] = await Promise.all([loadAttendance('group'), loadAttendance('groupId')]);
          allAttendance = [...byGroup, ...byGroupId]
            .filter((attendance, index, records) => records.findIndex(item => item.id === attendance.id) === index);
        }

        return allAttendance;
      })(),
      (async () => {
        const quizScoreMap: Record<string, Record<string, number>> = {};
        const includeFolkQuizzes = String(context.user.segment || '').toUpperCase() === 'FOLK';
        if (includeFolkQuizzes && memberUserIds.length > 0) {
          const { records: allQuizzes } = await BvQuizzes.findAll({
            fields: ['id', 'group', 'department'],
            limit: 500,
          });
          const quizIds = allQuizzes
            .filter((quiz: any) =>
              normalizeQuizDepartment(quiz.department, 'FOLK') === 'FOLK' &&
              groups.some((group: any) => legacyQuizMatchesGroup(quiz, group))
            )
            .map(quiz => quiz.id);

          const submissions = quizIds.length > 0
            ? await findAllByIn(
              query => BvQuizSubmissions.findAll(query),
              'user',
              memberUserIds,
              {},
              ['id', 'user', 'quiz', 'percentage', 'submittedAt'],
            )
            : [];
          for (const sub of submissions) {
              const uid = (Array.isArray(sub.user) ? sub.user[0] : sub.user) as string;
              const qid = (Array.isArray(sub.quiz) ? sub.quiz[0] : sub.quiz) as string;
              if (!uid || !qid || !quizIds.includes(qid) || !sub.submittedAt) continue;
              const subDate = String(sub.submittedAt).slice(0, 10);
              if (subDate < startDate || subDate > endDate) continue;
              if (!quizScoreMap[uid]) quizScoreMap[uid] = {};
              const existing = quizScoreMap[uid][subDate];
              const score = Math.round(Number(sub.percentage) || 0);
              if (existing === undefined || score > existing) {
                quizScoreMap[uid][subDate] = score;
              }
            }
        }

        return quizScoreMap;
      })(),
    ]);

    const callerAliases = new Set(bvUserAliases(context.user as any));
    const facilitatorAliases = new Set(groups.flatMap(group => bvGroupFacilitatorAliases(group)));
    const hierarchy = isPwDepartmentAdmin(context.user) ? null : await hierarchyPromise;
    const permittedUsers = users.filter(user => isUserInHierarchy(user, hierarchy));
    // The group's own RGF and RGSF stay on the member grid. Other callers
    // still stay off a report that is about the people they monitor.
    const scopedUsers = bvslMode && !isBvSupervisorUser(context.user as any) && input.segment !== 'PW'
      ? permittedUsers.filter(user => {
        const aliases = bvUserAliases(user as any);
        return aliases.some(alias => facilitatorAliases.has(alias))
          || !aliases.some(alias => callerAliases.has(alias));
      })
      : permittedUsers;
    const userMap = new Map<string, any>();
    scopedUsers.forEach(user => bvUserAliases(user).forEach(alias => userMap.set(alias, user)));

    // Build member list
    const seenUserIds = new Set<string>();
    const memberGroupMap = new Map<string, string>();
    for (const m of memberships) {
      const uid = (Array.isArray(m.user) ? m.user[0] : (m.user || (m as any).userId || (m as any).memberId)) as string;
      const gid = (Array.isArray(m.group) ? m.group[0] : (m.group || (m as any).groupId)) as string;
      const canonicalGroupId = groupCanonicalId.get(String(gid)) || String(gid);
      if (uid && canonicalGroupId) {
        const user = userMap.get(String(uid).trim().toLowerCase());
        if (user && !memberGroupMap.has(user.id)) memberGroupMap.set(user.id, canonicalGroupId);
      }
    }
    for (const group of groups) {
      const canonical = String(group.id);
      for (const alias of bvGroupFacilitatorAliases(group)) {
        const user = userMap.get(alias);
        if (user) memberGroupMap.set(user.id, canonical);
      }
    }

    const members: {
      userId: string;
      fullName: string;
      ashrayLevel: string | null;
      isResident: boolean;
      residencyName: string | null;
      groupId: string;
      groupName: string;
    }[] = [];

    for (const memberReference of memberUserIds) {
      const u = userMap.get(String(memberReference).trim().toLowerCase());
      if (!u) continue;
      const uid = String(u.id);
      if (seenUserIds.has(uid)) continue;
      seenUserIds.add(uid);
      const rawResId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const isResident = !!(u.residencyApproved && rawResId);
      const gid = memberGroupMap.get(uid) || '';
      members.push({
        userId: uid,
        fullName: (u.fullName as string) || '',
        ashrayLevel: (u.ashrayLevel as string) || null,
        isResident,
        residencyName: isResident && rawResId ? (residencyNameMap.get(rawResId as string) || null) : null,
        groupId: gid,
        groupName: groupNameMap.get(gid) || '',
      });
    }

    // Generate all dates in range
    const allDates: string[] = [];
    const cur = new Date(startDate + 'T00:00:00');
    const endD = new Date(endDate + 'T00:00:00');
    while (cur <= endD) {
      allDates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    const merged = mergeReportAttendance(
      allAttendance,
      memberGroupMap,
      reference => userMap.get(String(reference || '').trim().toLowerCase())?.id || reference,
      reference => groupCanonicalId.get(String(reference)) || String(reference || ''),
    );
    const attendanceMap = merged.attendance;
    const groupSessionDates = merged.groupSessionDates;
    const sessionDatesSet = new Set(merged.sessionDates);

    // For members whose group had a session but no attendance record → mark as absent
    for (const m of members) {
      const gDates = groupSessionDates.get(m.groupId);
      if (!gDates) continue;
      if (!attendanceMap[m.userId]) attendanceMap[m.userId] = {};
      for (const d of gDates) {
        if (attendanceMap[m.userId][d] === undefined) {
          attendanceMap[m.userId][d] = false;
        }
      }
    }

    const sessionDates = [...sessionDatesSet].sort();

    return {
      members,
      allDates,
      sessionDates,
      groups: groups.map(g => ({ id: g.id, name: g.groupName || '' })),
      attendance: attendanceMap,
      quizScores: quizScoreMap,
    };
  },
});
