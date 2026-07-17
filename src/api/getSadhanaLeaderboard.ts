import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, FolkResidencies } from 'zite-integrations-backend-sdk';
import { computeStreak, getTodayIST, daysAgo } from '../lib/streakUtils';

const ENTRY_FIELDS = ['id', 'user', 'entryDate', 'totalScore', 'scorePercent', 'maxScore', 'flagSick', 'flagOs', 'submittedAt'];
const STREAK_ENTRY_FIELDS = ['id', 'user', 'entryDate', 'scorePercent'];
const USER_FIELDS = ['id', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'guide', 'status', 'userId', 'role'];

/** Roles to exclude from the leaderboard — only administrative roles */
const EXCLUDED_ROLES = new Set(['Guide', 'Super Guide']);

/** Ashray seniority rank — lower = more senior = ranks higher */
const ASHRAY_RANK: Record<string, number> = {
  'Harinam Diksha': 1, 'Caranashraya': 2, 'Upasaka': 3,
  'Sadhaka': 4, 'Sevak': 5, 'Shraddhavan': 6, 'Jigyasa': 7,
};

export default createEndpoint({
  description: 'Get sadhana leaderboard — submitted users only, ranked by weighted score, guide roles excluded',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    residencyId: z.string().optional(),
    guideId: z.string().optional(),
    scope: z.enum(['residency', 'guide', 'global']).optional(),
    date: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.number().int().min(0).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const todayStr = getTodayIST();
    const startStr = (input.startDate || input.date || todayStr).split('T')[0];
    const endStr   = (input.endDate   || input.date || todayStr).split('T')[0];
    const isRange  = startStr !== endStr;

    // Total calendar days in the period (used for weighted score denominator)
    const totalDays = isRange
      ? Math.round((new Date(endStr + 'T00:00:00').getTime() - new Date(startStr + 'T00:00:00').getTime()) / 86400000) + 1
      : 1;

    // ── Fetch entries in date range ──────────────────────────────────────
    const allEntries: any[] = [];
    let entryOffset = 0;
    while (true) {
      const filter = isRange
        ? ({ entryDate: { gte: startStr, lte: endStr } } as any)
        : { entryDate: startStr };
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: filter,
        fields: ENTRY_FIELDS,
        limit: 2000,
        offset: entryOffset,
      });
      allEntries.push(...records);
      if (!hasMore) break;
      entryOffset += 2000;
    }

    if (allEntries.length === 0) {
      const currentUserResidencyId = Array.isArray(context.user.residency)
        ? context.user.residency[0] : context.user.residency;
      const currentUserIsResident = !!(context.user.residencyApproved && currentUserResidencyId);
      return {
        leaderboard: [], total: 0, totalDays,
        currentUserAshrayLevel: context.user.ashrayLevel || '',
        currentUserResidency: '', currentUserIsResident,
        currentUserGuideId: Array.isArray(context.user.guide) ? (context.user.guide[0] || '') : (context.user.guide || ''),
      };
    }

    // ── Fetch active users ────────────────────────────────────────────────
    const usersFilter = input.residencyId
      ? { status: 'Active', residency: input.residencyId }
      : input.guideId
      ? { status: 'Active', guide: input.guideId }
      : { status: 'Active' };

    const allUsers: any[] = [];
    let userOffset = 0;
    while (true) {
      const { records, hasMore } = await Users.findAll({
        filters: usersFilter,
        fields: USER_FIELDS,
        limit: 2000,
        offset: userOffset,
      });
      allUsers.push(...records);
      if (!hasMore) break;
      userOffset += 2000;
    }

    // ── Streak entries (100-day window up to endStr) ──────────────────────
    const streakRefDate = endStr <= todayStr ? endStr : todayStr;
    const streakStart   = daysAgo(streakRefDate, 100);
    const streakEntries: any[] = [];
    let streakOffset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: { gte: streakStart, lte: streakRefDate } } as any,
        fields: STREAK_ENTRY_FIELDS,
        limit: 2000,
        offset: streakOffset,
      });
      streakEntries.push(...records);
      if (!hasMore) break;
      streakOffset += 2000;
    }

    // Build streak history per user
    const userDbIds = new Set(allUsers.map(u => u.id));
    const streakByUser = new Map<string, Array<{ entryDate: string; scorePercent: number | null }>>();
    for (const e of streakEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid || !userDbIds.has(uid)) continue;
      if (!streakByUser.has(uid)) streakByUser.set(uid, []);
      streakByUser.get(uid)!.push({ entryDate: (e.entryDate as string) || '', scorePercent: e.scorePercent as number | null });
    }

    // ── Group entries by user DB ID ───────────────────────────────────────
    const entriesByUser = new Map<string, any[]>();
    for (const e of allEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(e);
    }

    // ── Residency names ───────────────────────────────────────────────────
    const residencyIds = [...new Set(
      allUsers.map(u => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean) as string[]
    )];
    const residencyNameMap: Record<string, string> = {};
    if (residencyIds.length > 0) {
      const recs = await Promise.all(residencyIds.map(id => FolkResidencies.findOne({ id, fields: ['id', 'residencyName'] }).catch(() => null)));
      recs.forEach(r => { if (r && r.id) residencyNameMap[r.id] = (r as any).residencyName || ''; });
    }

    const userMap = new Map(allUsers.map(u => [u.id, u]));

    // ── Build leaderboard entries ─────────────────────────────────────────
    const leaderboard = allUsers
      .map(u => {
        if (EXCLUDED_ROLES.has(u.role)) return null;
        const userEntries = entriesByUser.get(u.id) || [];
        if (userEntries.length === 0) return null; // only submitted users

        // Unique days submitted
        const daysSubmitted = new Set(userEntries.map(e => e.entryDate)).size;

        // Weighted % = sum(totalScore) / sum(maxScore) × 100 for multi-day ranges.
        // Averaging daily scorePercent values is wrong: Sick/OS days (max=8) produce
        // high daily %s that inflate the range average vs normal days (max=20).
        let avgScore: number | null;
        if (userEntries.length === 1) {
          const pct = userEntries[0]?.scorePercent;
          avgScore = pct != null ? Math.round(pct) : null;
        } else {
          const earned = userEntries.reduce((s, e) => s + (Number(e.totalScore) || 0), 0);
          const maxSum = userEntries.reduce((s, e) => s + (Number(e.maxScore) || 0), 0);
          if (maxSum > 0) {
            avgScore = Math.min(100, Math.round((earned / maxSum) * 100));
          } else {
            // Fallback: avg of stored scorePercent for entries lacking maxScore
            const scorePcts = userEntries.map(e => e.scorePercent).filter((v): v is number => v != null);
            avgScore = scorePcts.length > 0 ? Math.round(scorePcts.reduce((a, b) => a + b, 0) / scorePcts.length) : null;
          }
        }

        // Weighted score = avgScore × (daysSubmitted / totalDays)
        const weightedScore = avgScore != null
          ? Math.round(avgScore * (daysSubmitted / totalDays) * 10) / 10
          : null;

        const latestSubmit = userEntries
          .map(e => e.submittedAt as string | null)
          .filter(Boolean)
          .sort()
          .pop() ?? null;

        const residencyId  = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isResident   = !!(u.residencyApproved && residencyId);
        const currentStreak = computeStreak(streakByUser.get(u.id) || [], streakRefDate);

        // Flags — for daily use entry's flag; for range use "any day" flags
        const flagSick = userEntries.some(e => e.flagSick);
        const flagOs   = userEntries.some(e => e.flagOs);

        return {
          userId: u.userId || u.id,
          displayName: u.fullName || 'Unknown',
          guideName: '',
          guideId: Array.isArray(u.guide) ? (u.guide[0] || '') : (u.guide || ''),
          ashrayLevel: u.ashrayLevel || '',
          isResident,
          residencyId: residencyId || '',
          residencyName: isResident && residencyId ? (residencyNameMap[residencyId] || '') : '',
          todayScore: userEntries.reduce((s, e) => s + (e.totalScore ?? 0), 0),
          maxScore: userEntries[0]?.maxScore ?? 0,
          scorePercent: avgScore,
          weightedScore,
          daysSubmitted,
          totalDays,
          flagSick,
          flagOs,
          submittedAt: latestSubmit,
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

    const currentUserResidencyId = Array.isArray(context.user.residency)
      ? context.user.residency[0] : context.user.residency;
    const currentUserIsResident = !!(context.user.residencyApproved && currentUserResidencyId);
    const currentUserResidency  = currentUserIsResident && currentUserResidencyId
      ? (residencyNameMap[currentUserResidencyId] || currentUserResidencyId) : '';
    const currentUserGuideId    = Array.isArray(context.user.guide)
      ? (context.user.guide[0] || '') : (context.user.guide || '');

    return {
      leaderboard,
      total: leaderboard.length,
      totalDays,
      folkTotals,
      currentUserAshrayLevel: context.user.ashrayLevel || '',
      currentUserResidency,
      currentUserIsResident,
      currentUserGuideId,
    };
  },
});
