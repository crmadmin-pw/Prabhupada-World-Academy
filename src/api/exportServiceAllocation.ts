import { z } from 'zod';
import { createEndpoint, Services, ServiceAllocations, Users, FolkResidencies } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Export service allocation data — services as rows, weeks as columns',
  authenticated: true,
  inputSchema: z.object({
    serviceType: z.string(),
    residencyId: z.string(),
    weekDate: z.string(),        // center/current week (YYYY-MM-DD, Sunday)
    weeksToShow: z.number().optional(), // default 6 (2 past + current + 3 future)
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const { serviceType, residencyId, weekDate } = input;
    const weeksToShow = input.weeksToShow ?? 6;
    const weeksBefore = 2;

    // Resolve residency by custom ID
    const residency = await FolkResidencies.findOne({
      filters: { residencyId },
      fields: ['id', 'residencyName'],
    });
    if (!residency) {
      return { services: [], weekDates: [], grid: {}, residents: [], currentWeekDate: weekDate };
    }
    const residencyDbId = residency.id;

    // Build array of week start dates (2 past + current + 3 future)
    const centerDate = new Date(weekDate + 'T00:00:00');
    const startDate = new Date(centerDate);
    startDate.setDate(startDate.getDate() - weeksBefore * 7);

    const weekDates: string[] = [];
    for (let i = 0; i < weeksToShow; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i * 7);
      weekDates.push(d.toISOString().split('T')[0]);
    }
    const startDateStr = weekDates[0];
    const endDateStr = weekDates[weekDates.length - 1];

    // Fetch active services matching type + residency
    const { records: allServices } = await Services.findAll({
      filters: { isActive: true },
      limit: 300,
      fields: ['id', 'serviceName', 'serviceType', 'serviceScope', 'residency', 'sortOrder'],
    });
    const relevantServices = allServices
      .filter(s => {
        if (((s as any).serviceType as string) !== serviceType) return false;
        if ((s as any).serviceScope === 'General') return true;
        const svcRes = Array.isArray((s as any).residency) ? (s as any).residency[0] : (s as any).residency;
        return svcRes === residencyDbId;
      })
      .sort((a, b) => (((a as any).sortOrder ?? 99) - ((b as any).sortOrder ?? 99)));

    const relevantServiceIds = new Set(relevantServices.map(s => s.id));

    // Fetch active residents for this residency
    const { records: userRecords } = await Users.findAll({
      filters: { residencyApproved: true, status: 'Active', residency: residencyDbId },
      fields: ['id', 'fullName'],
      limit: 500,
    });
    const residents = userRecords
      .map(u => ({ id: u.id, name: ((u as any).fullName as string) || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (relevantServices.length === 0) {
      return { services: [], weekDates, grid: {}, residents, currentWeekDate: weekDate };
    }

    // Fetch all allocations for the date range in one query
    const { records: allocations } = await ServiceAllocations.findAll({
      filters: { weekDate: { gte: startDateStr, lte: endDateStr } as any },
      fields: ['service', 'user', 'weekDate', 'dayOfWeek'],
      limit: 5000,
    });

    // Build a user name map (seed with known residents, supplement from allocation user IDs)
    const userMap = new Map<string, string>();
    residents.forEach(r => userMap.set(r.id, r.name));

    const unknownUserIds = [...new Set(
      allocations.map(a => {
        const u = Array.isArray((a as any).user) ? (a as any).user[0] : (a as any).user;
        return u as string;
      }).filter(id => id && !userMap.has(id))
    )];
    if (unknownUserIds.length > 0) {
      const { records: extras } = await Users.findAll({
        filters: { id: { in: unknownUserIds } } as any,
        fields: ['id', 'fullName'],
        limit: 1000,
      });
      extras.forEach(u => userMap.set(u.id, ((u as any).fullName as string) || ''));
    }

    // Build grid: serviceId → weekDate → [{ userId, userName, dayOfWeek }]
    const grid: Record<string, Record<string, { userId: string; userName: string; dayOfWeek: string }[]>> = {};
    for (const a of allocations) {
      const svcId = Array.isArray((a as any).service) ? (a as any).service[0] : (a as any).service;
      const uid = Array.isArray((a as any).user) ? (a as any).user[0] : (a as any).user;
      const wDate = (a as any).weekDate as string;
      if (!svcId || !uid || !wDate) continue;
      if (!relevantServiceIds.has(svcId)) continue;
      if (!grid[svcId]) grid[svcId] = {};
      if (!grid[svcId][wDate]) grid[svcId][wDate] = [];
      grid[svcId][wDate].push({
        userId: uid,
        userName: userMap.get(uid) || uid,
        dayOfWeek: ((a as any).dayOfWeek as string) || '',
      });
    }

    return {
      services: relevantServices.map(s => ({ id: s.id, name: ((s as any).serviceName as string) || '' })),
      weekDates,
      grid,
      residents,
      currentWeekDate: weekDate,
    };
  },
});
