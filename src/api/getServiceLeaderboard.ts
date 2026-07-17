import { z } from 'zod';
import { createEndpoint, ServiceAllocations, ServiceRatings, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get service quality leaderboard based on anonymous peer ratings. Guides see full names; residents see top 3 anonymized + own rank.',
  authenticated: true,
  inputSchema: z.object({
    period: z.enum(['daily', 'weekly', 'monthly']),
    residencyId: z.string().optional(),
  }),
  outputSchema: z.object({
    entries: z.array(z.object({
      rank: z.number(),
      userId: z.string().nullable(),
      name: z.string().nullable(),
      avgRating: z.number(),
      completedCount: z.number(),
      completionRate: z.number(),
      trend: z.enum(['improving', 'stable', 'declining']),
      isCurrentUser: z.boolean(),
    })),
    myRank: z.number().nullable(),
    myAvgRating: z.number().nullable(),
    period: z.string(),
    dateRange: z.string(),
    isGuide: z.boolean(),
    totalRatings: z.number(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isGuide = ['Guide', 'Super Guide', 'BVSL', 'Sadhana Mentor'].includes(context.user.role ?? '') || context.user.isServiceAllocator === true;

    const { startDate, endDate } = getDateRange(input.period);

    // Get all allocations in range with 'Done' status
    const { records: allAllocs } = await ServiceAllocations.findAll({
      filters: { status: 'Done' },
      fields: ['id', 'service', 'user', 'dayOfWeek', 'weekDate', 'status', 'completedAt'],
      limit: 2000,
    });

    // Filter by date range
    const allocs = allAllocs.filter(a => {
      const wd = a.weekDate?.slice(0, 10) ?? '';
      return wd >= startDate && wd <= endDate;
    });

    // Get all ratings in range
    const { records: allRatings } = await ServiceRatings.findAll({
      fields: ['id', 'service', 'ratingDate', 'rating'],
      limit: 5000,
    });
    const ratings = allRatings.filter(r => {
      const rd = r.ratingDate?.slice(0, 10) ?? '';
      return rd >= startDate && rd <= endDate;
    });

    // Build rating map: serviceId+date -> avg rating
    const ratingMap = new Map<string, { sum: number; count: number }>();
    for (const r of ratings) {
      const svcId = Array.isArray(r.service) ? r.service[0] : r.service;
      if (!svcId || !r.ratingDate) continue;
      const key = `${svcId}::${r.ratingDate.slice(0, 10)}`;
      const cur = ratingMap.get(key) ?? { sum: 0, count: 0 };
      cur.sum += Number(r.rating ?? 0);
      cur.count += 1;
      ratingMap.set(key, cur);
    }

    // Compute per-user scores
    const userStats = new Map<string, { ratingSum: number; ratingCount: number; completedCount: number }>();
    for (const a of allocs) {
      const userId = Array.isArray(a.user) ? a.user[0] : a.user;
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      if (!userId || !svcId || !a.weekDate) continue;

      const dayDate = getDayDate(a.weekDate, a.dayOfWeek ?? '');
      const ratingKey = `${svcId}::${dayDate}`;
      const stats = ratingMap.get(ratingKey);

      const cur = userStats.get(userId) ?? { ratingSum: 0, ratingCount: 0, completedCount: 0 };
      cur.completedCount += 1;
      if (stats && stats.count >= 1) {
        cur.ratingSum += stats.sum / stats.count;
        cur.ratingCount += 1;
      }
      userStats.set(userId, cur);
    }

    // Filter users with min 3 ratings to appear on leaderboard
    const MIN_RATINGS = 3;
    const qualifiedUsers = [...userStats.entries()]
      .filter(([, s]) => s.ratingCount >= MIN_RATINGS)
      .map(([userId, s]) => ({
        userId,
        avgRating: Math.round((s.ratingSum / s.ratingCount) * 10) / 10,
        completedCount: s.completedCount,
      }))
      .sort((a, b) => b.avgRating - a.avgRating || b.completedCount - a.completedCount);

    // Get user names (guide only sees names, residents see anonymized)
    let nameMap = new Map<string, string>();
    if (isGuide && qualifiedUsers.length > 0) {
      const userIds = qualifiedUsers.map(u => u.userId);
      const { records: users } = await Users.findAll({
        filters: { id: { in: userIds } },
        fields: ['id', 'fullName'],
      });
      for (const u of users) nameMap.set(u.id, (u as any).fullName || 'Unknown');
    }

    // Get total allocations in range for completion rate
    const { records: allAllocsForRate } = await ServiceAllocations.findAll({
      fields: ['user', 'weekDate', 'status'],
      limit: 2000,
    });
    const totalByUser = new Map<string, number>();
    for (const a of allAllocsForRate) {
      const wd = a.weekDate?.slice(0, 10) ?? '';
      if (wd < startDate || wd > endDate) continue;
      const userId = Array.isArray(a.user) ? a.user[0] : a.user;
      if (!userId) continue;
      totalByUser.set(userId, (totalByUser.get(userId) ?? 0) + 1);
    }

    const entries = qualifiedUsers.map((u, i) => {
      const rank = i + 1;
      const total = totalByUser.get(u.userId) ?? u.completedCount;
      const completionRate = total > 0 ? Math.round((u.completedCount / total) * 100) : 100;
      const isCurrentUser = u.userId === context.user.id;

      // Privacy: residents only see own name + "Rank N" for others
      const showName = isGuide || isCurrentUser;
      return {
        rank,
        userId: isGuide ? u.userId : (isCurrentUser ? u.userId : null),
        name: showName ? (nameMap.get(u.userId) ?? (isCurrentUser ? (context.user.fullName ?? 'You') : null)) : null,
        avgRating: u.avgRating,
        completedCount: u.completedCount,
        completionRate,
        trend: 'stable' as const,
        isCurrentUser,
      };
    });

    const myEntry = entries.find(e => e.isCurrentUser);
    const totalRatings = ratings.length;

    const dateRange = `${startDate} – ${endDate}`;
    return {
      entries: isGuide ? entries : entries.slice(0, 3).concat(myEntry && !entries.slice(0, 3).find(e => e.isCurrentUser) ? [myEntry] : []),
      myRank: myEntry?.rank ?? null,
      myAvgRating: myEntry?.avgRating ?? null,
      period: input.period,
      dateRange,
      isGuide,
      totalRatings,
    };
  },
});

function getDateRange(period: 'daily' | 'weekly' | 'monthly'): { startDate: string; endDate: string } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (period === 'daily') {
    return { startDate: today, endDate: today };
  }
  if (period === 'weekly') {
    // Service week: Sunday → Saturday
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun);
    sat.setDate(sun.getDate() + 6);
    return { startDate: sun.toISOString().slice(0, 10), endDate: sat.toISOString().slice(0, 10) };
  }
  // monthly
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function getDayDate(weekDate: string, dayOfWeek: string): string {
  // Sunday is offset 0 (week start)
  const days: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
  const offset = days[dayOfWeek] ?? 0;
  const d = new Date(weekDate + 'T12:00:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
