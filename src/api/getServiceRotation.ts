import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

// Skilled services rotate less aggressively (quality > rotation)
const SKILLED_CATEGORIES = ['Altar', 'Tech'];
// General services rotate more aggressively
// Flag thresholds: skilled → warn at 4+ weeks, general → warn at 2+ weeks
function getFlag(category: string, streak: number): 'fair' | 'repeating' | 'overloaded' {
  const threshold = SKILLED_CATEGORIES.includes(category) ? 3 : 2;
  if (streak >= threshold + 1) return 'overloaded';
  if (streak >= threshold) return 'repeating';
  return 'fair';
}

export default createEndpoint({
  description: 'Get service rotation data for the last 4 weeks — used to show rotation health indicators on the allocation board',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string().optional(),
    weekStartDate: z.string(), // yyyy-MM-dd of the current week Monday
  }),
  outputSchema: z.object({
    // key: "userId::serviceId" → rotation info
    rotationMap: z.record(z.object({
      weeksAssigned: z.number(),   // how many of last 4 weeks
      streak: z.number(),          // consecutive weeks (most recent first)
      flag: z.enum(['fair', 'repeating', 'overloaded']),
      category: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    const currentWeek = input.weekStartDate;
    // Build list of 4 past week start dates (not including current week)
    const pastWeeks: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(currentWeek + 'T12:00:00');
      d.setDate(d.getDate() - 7 * i);
      pastWeeks.push(d.toISOString().slice(0, 10));
    }

    // Fetch allocations for those 4 past weeks
    const { records: allocs } = await ServiceAllocations.findAll({
      filters: { weekDate: { in: pastWeeks } },
      fields: ['id', 'service', 'user', 'weekDate', 'status'],
      limit: 2000,
    });

    // Get service categories
    const serviceIds = [...new Set(
      allocs.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean) as string[]
    )];

    const categoryMap = new Map<string, string>();
    if (serviceIds.length > 0) {
      const { records: svcs } = await Services.findAll({
        filters: { id: { in: serviceIds } },
        fields: ['id', 'category'],
      });
      for (const s of svcs) categoryMap.set(s.id, s.category ?? 'Other');
    }

    // Build per-user-service assignment history per week
    // key: userId::serviceId → Set of weekDates
    const assignmentsByWeek = new Map<string, Set<string>>();
    for (const a of allocs) {
      const userId = Array.isArray(a.user) ? a.user[0] : a.user;
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      const weekDate = a.weekDate?.slice(0, 10);
      if (!userId || !svcId || !weekDate) continue;
      const key = `${userId}::${svcId}`;
      const cur = assignmentsByWeek.get(key) ?? new Set<string>();
      cur.add(weekDate);
      assignmentsByWeek.set(key, cur);
    }

    // Compute rotation stats
    const rotationMap: Record<string, { weeksAssigned: number; streak: number; flag: 'fair' | 'repeating' | 'overloaded'; category: string }> = {};

    for (const [key, weekSet] of assignmentsByWeek.entries()) {
      const svcId = key.split('::')[1];
      const category = categoryMap.get(svcId) ?? 'Other';
      const weeksAssigned = weekSet.size;

      // Count streak: consecutive most-recent weeks
      let streak = 0;
      for (const week of pastWeeks) {
        if (weekSet.has(week)) streak++;
        else break;
      }

      rotationMap[key] = {
        weeksAssigned,
        streak,
        flag: getFlag(category, streak),
        category,
      };
    }

    return { rotationMap };
  },
});
