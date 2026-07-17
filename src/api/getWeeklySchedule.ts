import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get the weekly schedule for the current user',
  authenticated: true,
  inputSchema: z.object({ weekStartDate: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    const today = new Date();
    const sun = new Date(today); sun.setDate(today.getDate() - today.getDay());
    const weekStartDate = input.weekStartDate || sun.toISOString().split('T')[0];

    const allocRes = await ServiceAllocations.findAll({
      filters: { user: uid, weekDate: weekStartDate },
      limit: 100,
      fields: ['id', 'allocationId', 'service', 'dayOfWeek', 'status'],
    });

    if (allocRes.records.length === 0) return { schedule: [], weekStartDate };

    const svcIds = [...new Set(allocRes.records.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean))] as string[];
    const { records: svcRecords } = await Services.findAll({ filters: { id: { in: svcIds } }, fields: ['id', 'serviceName', 'timeSlot', 'category'] });
    const svcMap = new Map(svcRecords.map((s: any) => [s.id, s]));

    return {
      weekStartDate,
      schedule: allocRes.records.map(a => {
        const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
        const svc = svcMap.get(svcId || '');
        return {
          allocationId: a.allocationId || a.id,
          serviceName: svc?.serviceName || '',
          timeSlot: svc?.timeSlot || '',
          category: svc?.category || '',
          dayOfWeek: a.dayOfWeek || '',
          status: (a.status || 'Scheduled').toLowerCase(),
        };
      }),
    };
  },
});
