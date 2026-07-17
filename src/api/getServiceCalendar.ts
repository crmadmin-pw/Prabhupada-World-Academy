import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get service calendar for the current user',
  authenticated: true,
  inputSchema: z.object({ year: z.number().optional(), month: z.number().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const now = new Date();
    const year = input.year || now.getFullYear();
    const month = input.month || (now.getMonth() + 1);

    // Month range
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const allocRes = await ServiceAllocations.findAll({
      filters: { user: uid, weekDate: { gte: new Date(startDate), lt: new Date(endMonth) } },
      limit: 200,
      fields: ['id', 'allocationId', 'service', 'dayOfWeek', 'weekDate', 'status'],
    });

    if (allocRes.records.length === 0) return { entries: [] };

    // Get service details
    const svcIds = [...new Set(allocRes.records.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean))] as string[];
    const serviceMap: Record<string, any> = {};
    if (svcIds.length > 0) {
      const { records } = await Services.findAll({ filters: { id: { in: svcIds } }, fields: ['id', 'serviceName', 'timeSlot'] });
      records.forEach((s: any) => { serviceMap[s.id] = s; });
    }

    // Sunday is offset 0 (week start)
    const DAY_OFFSETS: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
    };

    // Group by actual date (weekDate + dayOfWeek offset)
    const dateMap = new Map<string, any[]>();
    for (const a of allocRes.records) {
      const weekDate = a.weekDate;
      if (!weekDate) continue;
      const offset = DAY_OFFSETS[a.dayOfWeek || ''] ?? 0;
      const d = new Date(weekDate + 'T00:00:00');
      d.setDate(d.getDate() + offset);
      const dateStr = d.toISOString().split('T')[0];
      if (dateStr < startDate || dateStr >= endMonth) continue;

      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      const svc = serviceMap[svcId || ''];
      const status = (a.status || 'Scheduled').toLowerCase().replace('scheduled', 'assigned');

      if (!dateMap.has(dateStr)) dateMap.set(dateStr, []);
      dateMap.get(dateStr)!.push({
        allocationId: a.allocationId || a.id,
        serviceName: svc?.serviceName || '',
        timeSlot: svc?.timeSlot || '',
        status,
      });
    }

    const entries = Array.from(dateMap.entries())
      .map(([date, services]) => ({ date, services }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { entries };
  },
});
