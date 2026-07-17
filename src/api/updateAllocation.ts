import { z } from 'zod';
import { createEndpoint, ServiceAllocations, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Update or delete a service allocation',
  authenticated: true,
  inputSchema: z.object({
    allocationId: z.string(),
    status: z.string().optional(),
    notes: z.string().optional(),
    userId: z.string().optional(),
    backupUserId: z.string().optional(),
    delete: z.boolean().optional(),
    reassignWholeWeek: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const record = await ServiceAllocations.findOne({ id: input.allocationId });
    if (!record) throw new ZiteError({ code: 'NOT_FOUND', message: 'Allocation not found' });

    if (input.delete) {
      await ServiceAllocations.delete({ id: input.allocationId });
      return { success: true };
    }

    // Reassign whole week: find all allocations for same service+weekDate and update all
    if (input.reassignWholeWeek && input.userId) {
      const serviceId = Array.isArray(record.service) ? record.service[0] : record.service;
      const weekDate = record.weekDate;

      if (!serviceId || !weekDate) {
        throw new ZiteError({ code: 'BAD_REQUEST', message: 'Cannot determine service or week for this allocation' });
      }

      const { records: allForWeek } = await ServiceAllocations.findAll({
        filters: { service: serviceId, weekDate },
        limit: 7,
      });

      for (const rec of allForWeek) {
        await ServiceAllocations.update({ id: rec.id, record: { user: input.userId } });
      }

      return { success: true, updatedCount: allForWeek.length };
    }

    const updates: any = {};
    if (input.status !== undefined) updates.status = input.status;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.userId !== undefined) updates.user = input.userId;
    if (input.backupUserId !== undefined) updates.backupUser = input.backupUserId;

    await ServiceAllocations.update({ id: input.allocationId, record: updates });

    return { success: true };
  },
});
