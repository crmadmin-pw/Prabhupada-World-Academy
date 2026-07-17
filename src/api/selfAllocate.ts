import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

const DAY_MAP: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

export default createEndpoint({
  description: 'Self-allocate to a service for specific days of the week',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    weekStartDate: z.string(),
    days: z.array(z.string()),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    // Verify service exists
    const svc = await Services.findOne({ id: input.serviceId, fields: ['id', 'isActive'] });
    if (!svc?.isActive) throw new Error('Service not found or inactive');

    // Check for existing allocations to avoid duplicates
    const existing = await ServiceAllocations.findAll({
      filters: { user: uid, service: input.serviceId, weekDate: input.weekStartDate },
      fields: ['id', 'dayOfWeek'],
    });
    const existingDays = new Set(existing.records.map(a => a.dayOfWeek?.toLowerCase().slice(0, 3) || ''));

    const newDays = input.days.filter(d => !existingDays.has(d));
    if (newDays.length === 0) return { created: 0, message: 'Already allocated for all requested days' };

    const records = newDays.map(day => ({
      service: input.serviceId,
      user: uid,
      weekDate: input.weekStartDate,
      dayOfWeek: DAY_MAP[day] || day,
      status: 'Scheduled' as const,
    }));

    // Bulk create in batches of 50
    let created = 0;
    for (let i = 0; i < records.length; i += 50) {
      const res = await ServiceAllocations.bulkCreate({ records: records.slice(i, i + 50) });
      created += res.records.length;
    }
    return { created, success: true };
  },
});
