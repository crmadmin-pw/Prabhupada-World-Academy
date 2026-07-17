import { z } from 'zod';
import { createEndpoint, ServiceAllocations } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Bulk import/replace service allocations for a week. Replaces ALL existing records for the given services.',
  authenticated: true,
  inputSchema: z.object({
    weekDate: z.string(),
    serviceType: z.string(),
    residencyId: z.string(),
    assignments: z.array(z.object({
      userId: z.string(),
      serviceId: z.string(),
      dayOfWeek: z.string(),
    })),
    /** Service IDs whose allocations should be deleted without replacement */
    clearServiceIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({ created: z.number(), replaced: z.number() }),
  execute: async ({ input }) => {
    const { weekDate, assignments } = input;
    const clearServiceIds = input.clearServiceIds ?? [];

    // All service IDs that need their existing allocations deleted (full replace)
    const serviceIds = [...new Set(assignments.map(a => a.serviceId))];
    const allServiceIdsToDelete = [...new Set([...serviceIds, ...clearServiceIds])];

    if (allServiceIdsToDelete.length === 0 && assignments.length === 0) {
      return { created: 0, replaced: 0 };
    }

    // Find existing allocations for this week for the affected services
    const { records: existing } = await ServiceAllocations.findAll({
      filters: { weekDate },
      fields: ['id', 'service'],
      limit: 2000,
    });

    // Delete ALL records for the affected services (replace semantics, not upsert)
    const toDelete = existing.filter(a => {
      const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
      return allServiceIdsToDelete.includes(svcId ?? '');
    });

    const BATCH = 20;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      await Promise.all(toDelete.slice(i, i + BATCH).map(d => ServiceAllocations.delete({ id: d.id })));
    }

    // Bulk-create new allocations in batches of 100
    let created = 0;
    for (let i = 0; i < assignments.length; i += 100) {
      const batch = assignments.slice(i, i + 100);
      const res = await ServiceAllocations.bulkCreate({
        records: batch.map(a => ({
          service: a.serviceId,
          user: a.userId,
          weekDate,
          dayOfWeek: a.dayOfWeek as any,
          status: 'Scheduled',
        })),
      });
      created += res.records.length;
    }

    return { created, replaced: toDelete.length };
  },
});
