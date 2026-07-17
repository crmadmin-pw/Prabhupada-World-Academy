import { z } from 'zod';
import { createEndpoint, Users, BvGroups, BvGroupMembers, BvAttendance, BvQuizzes, BvQuizSubmissions, FolkResidencies } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideIdsForResidencies } from '../lib/guideScope';

export default createEndpoint({
  description: 'BV attendance + quiz matrix — person × date grid for guides/bvsls (queries attendance directly by group+date)',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    groupId: z.string().optional(),
    bvslMode: z.boolean().optional(),
    residencyIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor: (context.user as any).isBvMentor });

    const { guideId, startDate, endDate, groupId, bvslMode, residencyIds } = input;

    // Get groups
    const groupFilter: any = { isActive: true };
    if (bvslMode) {
      groupFilter.bvslLeader = context.user.id;
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

    const { records: groups } = await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupName', 'bvslLeader'],
      limit: 200,
    });

    if (groups.length === 0) {
      return { members: [], allDates: [], sessionDates: [], groups: [], attendance: {}, quizScores: {} };
    }

    const groupIds = groups.map(g => g.id);
    const groupNameMap = new Map(groups.map(g => [g.id, (g.groupName || '') as string]));

    // Get all members for these groups
    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { group: { in: groupIds } } as any,
      fields: ['id', 'user', 'group'],
      limit: 2000,
    });

    const memberUserIds = [
      ...new Set(
        memberships
          .map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string)
          .filter(Boolean)
      ),
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

    // Get user details
    const { records: users } = await Users.findAll({
      filters: { id: { in: memberUserIds } } as any,
      fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved'],
      limit: 1000,
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    // Build member list
    const seenUserIds = new Set<string>();
    const memberGroupMap = new Map<string, string>();
    for (const m of memberships) {
      const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
      const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
      if (uid && gid && !memberGroupMap.has(uid)) memberGroupMap.set(uid, gid);
    }

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

    const members: {
      userId: string;
      fullName: string;
      ashrayLevel: string | null;
      isResident: boolean;
      residencyName: string | null;
      groupId: string;
      groupName: string;
    }[] = [];

    for (const uid of memberUserIds) {
      if (seenUserIds.has(uid)) continue;
      seenUserIds.add(uid);
      const u = userMap.get(uid);
      if (!u) continue;
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

    // Query attendance by group+date range directly (new approach)
    let allAttendance: any[] = [];
    if (groupIds.length > 0) {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await BvAttendance.findAll({
          filters: {
            group: { in: groupIds },
            attendanceDate: { gte: startDate, lte: endDate },
          } as any,
          fields: ['id', 'group', 'user', 'present', 'attendanceDate'],
          limit: 2000,
          offset,
        });
        allAttendance = allAttendance.concat(records);
        if (!hasMore) break;
        offset += 2000;
      }
    }

    // Build attendance map: userId → date → boolean
    const attendanceMap: Record<string, Record<string, boolean>> = {};
    const sessionDatesSet = new Set<string>();
    const groupSessionDates = new Map<string, Set<string>>();

    for (const a of allAttendance) {
      const uid = (Array.isArray(a.user) ? a.user[0] : a.user) as string;
      const date = String(a.attendanceDate || '').slice(0, 10);
      const gid = (Array.isArray(a.group) ? a.group[0] : a.group) as string;
      if (!uid || !date) continue;

      if (!attendanceMap[uid]) attendanceMap[uid] = {};
      attendanceMap[uid][date] = !!a.present;
      sessionDatesSet.add(date);

      if (gid) {
        if (!groupSessionDates.has(gid)) groupSessionDates.set(gid, new Set());
        groupSessionDates.get(gid)!.add(date);
      }
    }

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

    // Get quizzes for these groups
    const { records: quizzes } = await BvQuizzes.findAll({
      filters: { group: { in: groupIds } } as any,
      fields: ['id', 'group'],
      limit: 200,
    });

    const quizIds = quizzes.map(q => q.id);

    // Get quiz submissions
    const quizScoreMap: Record<string, Record<string, number>> = {};
    if (quizIds.length > 0 && memberUserIds.length > 0) {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await BvQuizSubmissions.findAll({
          filters: { user: { in: memberUserIds } } as any,
          fields: ['id', 'user', 'quiz', 'percentage', 'submittedAt'],
          limit: 2000,
          offset,
        });
        for (const sub of records) {
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
        if (!hasMore) break;
        offset += 2000;
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
