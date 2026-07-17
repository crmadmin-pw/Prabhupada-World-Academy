import { z } from 'zod';
import { createEndpoint, ServiceAllocations, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Copy last week service allocations to this week',
  authenticated: true,
  inputSchema: z.object({
    thisWeekStartDate: z.string().optional(),
    weekStartDate: z.string().optional(),
    residencyId: z.string().optional(),
    skipUnavailable: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const thisWeekStr = input.thisWeekStartDate || input.weekStartDate;
    if (!thisWeekStr) throw new ZiteError({ code: 'BAD_REQUEST', message: 'thisWeekStartDate is required' });

    const thisWeek = new Date(thisWeekStr);
    const lastWeek = new Date(thisWeek.getTime() - 7 * 86400_000);
    const lastWeekStr = lastWeek.toISOString().split('T')[0];

    const { records: lastWeekAllocs } = await ServiceAllocations.findAll({
      filters: { weekDate: lastWeekStr },
      fields: ['id', 'service', 'user', 'notes', 'dayOfWeek'],
      limit: 500,
    });

    if (lastWeekAllocs.length === 0) return { success: true, copiedCount: 0, copied: 0, skipped: 0, alreadyExists: false };

    const { records: existing } = await ServiceAllocations.findAll({
      filters: { weekDate: thisWeekStr },
      fields: ['id', 'service', 'user'],
      limit: 500,
    });

    if (existing.length > 0) {
      return { success: true, copiedCount: 0, copied: 0, skipped: lastWeekAllocs.length, alreadyExists: true };
    }

    const toCreate = lastWeekAllocs.map((a: any) => ({
      service: Array.isArray(a.service) ? a.service[0] : a.service,
      user: Array.isArray(a.user) ? a.user[0] : a.user,
      weekDate: thisWeekStr,
      dayOfWeek: a.dayOfWeek,
      notes: (a.notes as string) || '',
      status: 'Scheduled',
    }));

    if (toCreate.length > 0) {
      await ServiceAllocations.bulkCreate({ records: toCreate });
    }

    return { success: true, copiedCount: toCreate.length, copied: toCreate.length, skipped: 0, alreadyExists: false };
  },
});
