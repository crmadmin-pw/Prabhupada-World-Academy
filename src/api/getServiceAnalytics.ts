import { z } from 'zod';
import { createEndpoint, Services, ServiceAllocations, Users, FolkResidencies } from 'zite-integrations-backend-sdk';
import { format, addDays } from 'date-fns';

// Service week starts on Sunday
function getSundayOf(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return format(d, 'yyyy-MM-dd');
}

export default createEndpoint({
  description: 'Get service analytics: completion rates, workload distribution, overdue trends, top performers, coverage gaps',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string().optional(),
    weeksBack: z.number().optional(), // Default 8
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const weeksBack = input.weeksBack || 8;
    const today = new Date();
    const thisMonday = getSundayOf(today);
    const startDate = format(addDays(new Date(thisMonday + 'T00:00:00'), -(weeksBack - 1) * 7), 'yyyy-MM-dd');

    // Get services
    const { records: allServices } = await Services.findAll({ filters: { isActive: true }, limit: 200 });
    let residencyDbId: string | undefined;
    if (input.residencyId) {
      const res = await FolkResidencies.findOne({ filters: { residencyId: input.residencyId }, fields: ['id'] });
      if (res) residencyDbId = res.id;
    }
    const services = allServices.filter(s => {
      if (s.serviceScope === 'General') return true;
      if (s.serviceScope === 'Residency' && residencyDbId) {
        const r = Array.isArray(s.residency) ? s.residency[0] : s.residency;
        return r === residencyDbId;
      }
      return false;
    });

    // Get all allocations in range
    const allocRes = await ServiceAllocations.findAll({
      filters: { weekDate: { gte: startDate } as any },
      limit: 2000,
      fields: ['id', 'service', 'user', 'weekDate', 'dayOfWeek', 'status'],
    });
    const allocations = allocRes.records;

    // User names
    const userIds = [...new Set(allocations.map(a => Array.isArray(a.user) ? a.user[0] : a.user).filter(Boolean))] as string[];
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const usersRes = await Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'fullName'], limit: 500 });
      usersRes.records.forEach(u => { userMap[u.id] = u.fullName || ''; });
    }

    // 1. Completion rates per service
    const svcStats: Record<string, { total: number; done: number; overdue: number }> = {};
    for (const svc of services) {
      svcStats[svc.id] = { total: 0, done: 0, overdue: 0 };
    }
    for (const a of allocations) {
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      if (!svcId || !svcStats[svcId]) continue;
      svcStats[svcId].total++;
      const s = (a.status || '').toLowerCase();
      if (s === 'done') svcStats[svcId].done++;
      else if (s === 'overdue') svcStats[svcId].overdue++;
    }
    const completionRates = services.map(svc => ({
      serviceId: svc.id,
      serviceName: svc.serviceName || '',
      total: svcStats[svc.id]?.total || 0,
      done: svcStats[svc.id]?.done || 0,
      overdue: svcStats[svc.id]?.overdue || 0,
      completionRate: svcStats[svc.id]?.total
        ? Math.round((svcStats[svc.id].done / svcStats[svc.id].total) * 100)
        : 0,
    })).filter(s => s.total > 0).sort((a, b) => b.completionRate - a.completionRate);

    // 2. Workload per resident (total allocations)
    const workloadMap: Record<string, { total: number; done: number }> = {};
    for (const a of allocations) {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user;
      if (!uid) continue;
      if (!workloadMap[uid]) workloadMap[uid] = { total: 0, done: 0 };
      workloadMap[uid].total++;
      if ((a.status || '').toLowerCase() === 'done') workloadMap[uid].done++;
    }
    const workloadDistribution = Object.entries(workloadMap).map(([uid, stats]) => ({
      userId: uid,
      userName: userMap[uid] || '',
      totalAllocations: stats.total,
      completed: stats.done,
      completionRate: stats.total ? Math.round((stats.done / stats.total) * 100) : 0,
    })).sort((a, b) => b.totalAllocations - a.totalAllocations);

    // 3. Overdue trend per week
    const weekOverdueMap: Record<string, number> = {};
    const weekTotalMap: Record<string, number> = {};
    for (let i = 0; i < weeksBack; i++) {
      const wk = format(addDays(new Date(thisMonday + 'T00:00:00'), -i * 7), 'yyyy-MM-dd');
      weekOverdueMap[wk] = 0;
      weekTotalMap[wk] = 0;
    }
    for (const a of allocations) {
      const wk = a.weekDate || '';
      if (!(wk in weekOverdueMap)) continue;
      weekTotalMap[wk]++;
      if ((a.status || '').toLowerCase() === 'overdue') weekOverdueMap[wk]++;
    }
    const overdueTrend = Object.keys(weekOverdueMap)
      .sort()
      .map(wk => ({
        week: wk,
        weekLabel: format(new Date(wk + 'T00:00:00'), 'd MMM'),
        overdue: weekOverdueMap[wk],
        total: weekTotalMap[wk],
      }));

    // 4. Top performers (by completion rate, min 3 allocations)
    const topPerformers = workloadDistribution
      .filter(u => u.totalAllocations >= 3)
      .sort((a, b) => {
        if (b.completionRate !== a.completionRate) return b.completionRate - a.completionRate;
        return b.completed - a.completed;
      })
      .slice(0, 10);

    // 5. Coverage gaps: service × day combos with zero allocations in last 4 weeks
    const recentStart = format(addDays(new Date(thisMonday + 'T00:00:00'), -27), 'yyyy-MM-dd');
    const recentAllocs = allocations.filter(a => (a.weekDate || '') >= recentStart);
    const covered = new Set<string>();
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const a of recentAllocs) {
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      covered.add(`${svcId}::${a.dayOfWeek}`);
    }
    const coverageGaps: { serviceId: string; serviceName: string; day: string }[] = [];
    for (const svc of services) {
      for (const d of DAYS) {
        if (!covered.has(`${svc.id}::${d}`)) {
          coverageGaps.push({ serviceId: svc.id, serviceName: svc.serviceName || '', day: d });
        }
      }
    }

    // 6. Rotation fairness: coefficient of variation of allocations per resident
    const allocCounts = workloadDistribution.map(w => w.totalAllocations);
    const mean = allocCounts.length > 0 ? allocCounts.reduce((a, b) => a + b, 0) / allocCounts.length : 0;
    const variance = allocCounts.length > 0
      ? allocCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / allocCounts.length
      : 0;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    const rotationFairnessScore = Math.round(Math.max(0, (1 - cv) * 100));

    return {
      completionRates,
      workloadDistribution,
      overdueTrend,
      topPerformers,
      coverageGaps,
      rotationFairnessScore,
      summary: {
        totalAllocations: allocations.length,
        totalDone: allocations.filter(a => (a.status || '').toLowerCase() === 'done').length,
        totalOverdue: allocations.filter(a => (a.status || '').toLowerCase() === 'overdue').length,
        weeksAnalysed: weeksBack,
        activeResidents: workloadDistribution.length,
      },
    };
  },
});
