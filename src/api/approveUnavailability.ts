import { z } from 'zod';
import { createEndpoint, UnavailabilityRequests, ServiceAllocations, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Approve or reject an unavailability request. If approved and allocation exists, promote backup user.',
  authenticated: true,
  inputSchema: z.object({
    requestId: z.string(),
    action: z.enum(['approve', 'reject']),
    notes: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isGuide = role === 'Guide' || role === 'Super Guide' || context.user.isServiceAllocator === true;
    if (!isGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or service allocators can approve unavailability requests' });
    }

    const request = await UnavailabilityRequests.findOne({ id: input.requestId });
    if (!request) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'Request not found' });
    }

    const newStatus = input.action === 'approve' ? 'Approved' : 'Rejected';
    await UnavailabilityRequests.update({
      id: input.requestId,
      record: {
        status: newStatus,
        reviewedBy: context.user.id,
      },
    });

    let backupPromoted = false;

    // If approved and there's a linked allocation, promote backup to primary
    if (input.action === 'approve') {
      const allocId = Array.isArray(request.serviceAllocation) ? request.serviceAllocation[0] : request.serviceAllocation;
      if (allocId) {
        const alloc = await ServiceAllocations.findOne({ id: allocId });
        if (alloc) {
          const backupUserId = Array.isArray(alloc.backupUser) ? alloc.backupUser[0] : alloc.backupUser;
          if (backupUserId) {
            // Remove original allocation
            await ServiceAllocations.delete({ id: allocId });
            // Create new allocation for backup user
            const { service, weekDate, dayOfWeek } = alloc;
            await ServiceAllocations.create({
              record: {
                service: Array.isArray(service) ? service[0] : service,
                user: backupUserId,
                weekDate: weekDate,
                dayOfWeek: dayOfWeek,
                status: 'Scheduled',
                notes: `Auto-promoted from backup (unavailability approved)`,
              },
            });
            backupPromoted = true;
          } else {
            // No backup — mark allocation as needing reassignment via notes
            await ServiceAllocations.update({
              id: allocId,
              record: { notes: '⚠️ Resident unavailable — needs reassignment' },
            });
          }
        }
      }
    }

    return { success: true, status: newStatus, backupPromoted };
  },
});
