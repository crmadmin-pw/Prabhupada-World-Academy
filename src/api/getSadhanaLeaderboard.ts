import { z } from 'zod';
import { getDashboardHierarchyScope, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { createEndpoint, Users, FolkResidencies } from '@/lib/backend-sdk';
import { computeStreak, getTodayIST } from '../lib/streakUtils';
import { getGuideScope } from '../lib/guideScope';
import { bvUserAliases, resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';
import { requireGuideRole } from '../lib/userUtils';
import { resolveBvAdminFacilitators } from '../lib/bvAdminFacilitatorScope';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { aggregateForAliases, loadLeaderboardFacts, scoreFromAggregate } from '../lib/sadhanaPeriodSummary';

const USER_FIELDS = ['id', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'ashrayLevel', 'residency', 'residencyApproved', 'guide', 'status', 'userId', 'role', 'currentStreak', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

/** Roles to exclude from the leaderboard — only administrative roles */
const EXCLUDED_ROLES = new Set(['Guide', 'Super Guide']);

/** Ashray seniority rank — lower = more senior = ranks higher */
const ASHRAY_RANK: Record<string, number> = {
  'Harinam Diksha': 1, 'Caranashraya': 2, 'Upasaka': 3,
  'Sadhaka': 4, 'Sevak': 5, 'Shraddhavan': 6, 'Jigyasa': 7,
};

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function getResidentState(user: any) {
  const residencyId = firstValue(user?.residency);
  const isResident = !!((user?.residencyApproved || user?.residencyGuideVerified) && residencyId);
  return { residencyId, isResident };
}

export default createEndpoint({
  description: 'Get sadhana leaderboard from stored period summaries — submitted users only, ranked by weighted score, guide roles excluded',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    residencyId: z.string().optional(),
    guideId: z.string().optional(),
    scope: z.enum(['residency', 'guide', 'global']).optional(),
    bvslMode: z.boolean().optional(),
    facilitatorMode: z.boolean().optional(),
    groupId: z.string().optional(),
    date: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.number().int().min(0).optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (input.bvslMode) {
      requireGuideRole(context.user.role, {
        isBvsl: context.user.isBvsl,
        isBvMentor: context.user.isBvMentor,
        isBvSupervisor: context.user.isBvSupervisor,
        isBvSubFacilitator: context.user.isBvSubFacilitator,
        isBvAdmin: context.user.isBvAdmin,
        isBvSuperAdmin: context.user.isBvSuperAdmin,
      });
    }
    const sessionUserId = String(input.userId || context.user.userId || context.user.id || '');
    const sessionEmail = String(context.user.email || '').toLowerCase();
    const todayStr = getTodayIST();
    const startStr = (input.startDate || input.date || todayStr).split('T')[0];
    const endStr   = (input.endDate   || input.date || todayStr).split('T')[0];
    const isRange  = startStr !== endStr;

    // Total calendar days in the period (used for weighted score denominator)
    const totalDays = isRange
      ? Math.round((new Date(endStr + 'T00:00:00').getTime() - new Date(startStr + 'T00:00:00').getTime()) / 86400000) + 1
      : 1;

    // Scores and historical streaks are read from stored period summaries.
    // A period is built from Sadhana entries once; later views do not rescan it.
    const facts = await loadLeaderboardFacts(startStr, endStr, todayStr);
    const streakRefDate = endStr <= todayStr ? endStr : todayStr;
    const needsHistoricalStreak = streakRefDate < todayStr;

    if (facts.aggregates.size === 0) {
      const { residencyId: currentUserResidencyId, isResident: currentUserIsResident } = getResidentState(context.user);
      return {
        leaderboard: [], total: 0, totalDays,
        currentUserAshrayLevel: context.user.ashrayLevel || '',
        currentUserResidency: '', currentUserIsResident,
        currentUserGuideId: firstValue(context.user.guide),
      };
    }

    const userRole = (context.user.role || 'User').toUpperCase().replace(/\s+/g, '_');
    const userEmail = (context.user.email || '').toLowerCase();
    const isSuperGuide = userRole === 'SUPER_GUIDE' ||
      userRole === 'SUPER_ADMIN' ||
      userRole === 'PW_ADMIN' ||
      !!context.user.isBvSuperAdmin ||
      !!context.user.isBvAdmin;

    // 1. Find guide record for scoping (regular guide only)
    let guideRecord: any = null;
    let guideRids: string[] = [];
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email || '');
      guideRecord = scope ? { id: scope.guideId } : null;
      guideRids = scope?.residencyIds || [];
    }

    // 2. Build user query filters
    const usersFilter: any = { status: 'Active' };
    if (!isSuperGuide && guideRecord) {
      usersFilter.guide = (guideRecord as any).id;
    }
    if (input.residencyId) {
      usersFilter.residency = input.residencyId;
    }

    // 3. Fetch active users
    let allUsers: any[] = [];
    let userOffset = 0;
    while (true) {
      const { records, hasMore } = await readScopedUsers(context.user, {
        filters: usersFilter,
        fields: USER_FIELDS,
        limit: 2000,
        offset: userOffset,
      });
      allUsers.push(...records);
      if (!hasMore) break;
      userOffset += 2000;
    }

    // Include residency-based users for regular guides
    if (!isSuperGuide && guideRecord && !input.residencyId) {
      if (guideRids.length > 0) {
        const resFetches = await Promise.all(
          guideRids.map(rid =>
            readScopedUsers(context.user, { filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })
          )
        );
        const userMap = new Map<string, any>();
        for (const u of allUsers) userMap.set(u.id, u);
        for (const res of resFetches) {
          for (const u of res.records) userMap.set(u.id, u);
        }
        allUsers = Array.from(userMap.values());
      }
    }

    if (input.bvslMode) {
      allUsers = await resolveBvGroupMemberUsers(context.user, USER_FIELDS, {
        groupId: input.groupId,
        segment: String(context.user.segment || '').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW',
        excludeCaller: true,
      });
    } else if (input.facilitatorMode) {
      allUsers = await resolveBvAdminFacilitators(context.user, input.guideId, USER_FIELDS, input.segment);
    }
    if (!input.bvslMode && input.segment) {
      allUsers = allUsers.filter(user => {
        const explicit = String(user.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
        const userSegment = explicit === 'PW' || explicit === 'PRABHUPADAWORLD' || user.isPrabhupadaWorldUser === true ? 'PW'
          : explicit === 'FOLK' ? 'FOLK' : '';
        return userSegment === input.segment;
      });
    }

    const hierarchy = await getDashboardHierarchyScope(context.user, input.guideId);
    allUsers = allUsers.filter(user => isUserInHierarchy(user, hierarchy));

    // ── Residency names ───────────────────────────────────────────────────
    const residencyIds = [...new Set(
      allUsers.map(u => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean) as string[]
    )];
    const residencyNameMap: Record<string, string> = {};
    if (residencyIds.length > 0) {
      for (let i = 0; i < residencyIds.length; i += 30) {
        const { records } = await FolkResidencies.findAll({
          filters: { id: { in: residencyIds.slice(i, i + 30) } },
          fields: ['id', 'residencyName'],
          limit: 30,
        });
        records.forEach(r => { if (r.id) residencyNameMap[r.id] = (r as any).residencyName || ''; });
      }
    }

    const currentUserRecord =
      allUsers.find((u: any) =>
        u.id === sessionUserId ||
        u.userId === sessionUserId ||
        String(u.email || '').toLowerCase() === sessionEmail
      ) ||
      (sessionUserId
        ? await Users.findOne({
            filters: { userId: sessionUserId } as any,
            fields: [...USER_FIELDS, 'email', 'residencyGuideVerified'],
          })
        : null) ||
      (sessionEmail
        ? await Users.findOne({
            filters: { email: sessionEmail } as any,
            fields: [...USER_FIELDS, 'email', 'residencyGuideVerified'],
          })
        : null);

    // ── Build leaderboard entries ─────────────────────────────────────────
    const leaderboard = allUsers
      .map(u => {
        if (EXCLUDED_ROLES.has(u.role)) return null;
        const matched = aggregateForAliases(bvUserAliases(u), facts);
        const aggregate = matched.aggregate;
        if (!aggregate || aggregate.entryCount === 0) return null;

        const daysSubmitted = aggregate.entryDates.length;
        // Weighted % = sum(totalScore) / sum(maxScore) × 100 for multi-day ranges.
        // Averaging daily scorePercent values is wrong: Sick/OS days (max=8) produce
        // high daily %s that inflate the range average vs normal days (max=20).
        const avgScore = scoreFromAggregate(aggregate, isPwSadhanaUser(u));
        const weightedScore = avgScore != null
          ? Math.round(avgScore * (daysSubmitted / totalDays) * 10) / 10
          : null;
        const currentStreak = needsHistoricalStreak
          ? (matched.qualifyingDates.length
            ? computeStreak(matched.qualifyingDates.map(entryDate => ({ entryDate, scorePercent: 75 })), streakRefDate)
            : matched.streakAtEnd)
          : (Number(u.currentStreak) || 0);

        const residencyId  = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isResident   = !!(u.residencyApproved && residencyId);

        return {
          userId: u.userId || u.id,
          displayName: u.fullName || 'Unknown',
          guideName: '',
          guideId: Array.isArray(u.guide) ? (u.guide[0] || '') : (u.guide || ''),
          ashrayLevel: u.ashrayLevel || '',
          isResident,
          residencyId: residencyId || '',
          residencyName: isResident && residencyId ? (residencyNameMap[residencyId] || '') : '',
          todayScore: aggregate.totalScore,
          maxScore: aggregate.latestMaxScore,
          scorePercent: avgScore,
          weightedScore,
          daysSubmitted,
          totalDays,
          flagSick: aggregate.flagSick,
          flagOs: aggregate.flagOs,
          submittedAt: aggregate.latestSubmittedAt,
          currentStreak,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        // 1. Weighted score (higher = better)
        const aw = a.weightedScore ?? -1;
        const bw = b.weightedScore ?? -1;
        if (bw !== aw) return bw - aw;
        // 2. Avg score (tiebreaker — penalises missed days equally)
        const as_ = a.scorePercent ?? 0;
        const bs_ = b.scorePercent ?? 0;
        if (bs_ !== as_) return bs_ - as_;
        // 3. Ashray seniority
        const ar = ASHRAY_RANK[a.ashrayLevel || ''] ?? 99;
        const br = ASHRAY_RANK[b.ashrayLevel || ''] ?? 99;
        if (ar !== br) return ar - br;
        // 4. Current streak
        if (b.currentStreak !== a.currentStreak) return (b.currentStreak ?? 0) - (a.currentStreak ?? 0);
        // 5. Earliest submission time
        const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
        const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
        return aTime - bTime;
      });

    // ── Per-FOLK total official resident counts (for weighted score in user dashboard) ──
    const folkTotals: Record<string, number> = {};
    for (const u of allUsers) {
      if (!u.residencyApproved) continue;
      const resId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      if (!resId) continue;
      const resName = residencyNameMap[resId] || resId;
      folkTotals[resName] = (folkTotals[resName] || 0) + 1;
    }

    const currentUserSource = currentUserRecord || context.user;
    const { residencyId: currentUserResidencyId, isResident: currentUserIsResident } = getResidentState(currentUserSource);
    const currentUserResidency  = currentUserIsResident && currentUserResidencyId
      ? (residencyNameMap[currentUserResidencyId] || currentUserResidencyId) : '';
    const currentUserGuideId    = firstValue(currentUserSource.guide);

    return {
      leaderboard,
      total: leaderboard.length,
      totalDays,
      folkTotals,
      currentUserAshrayLevel: currentUserSource.ashrayLevel || context.user.ashrayLevel || '',
      currentUserResidency,
      currentUserIsResident,
      currentUserGuideId,
    };
  },
});
