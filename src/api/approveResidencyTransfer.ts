import { z } from 'zod';
import { createEndpoint, ResidencyTransferRequests, Users, Guides, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Approve or reject a residency transfer request — only receiving residency guides can act',
  authenticated: true,
  inputSchema: z.object({
    requestId: z.string().optional(),
    rowId: z.string().optional(),
    logId: z.string().optional(),
    action: z.enum(['approve', 'reject']),
    notes: z.string().optional(),
    userId: z.string().optional(),
    guideId: z.string().optional(),
    oldResidencyId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const id = input.requestId || input.rowId || input.logId;
    if (!id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'requestId is required' });

    const request = await ResidencyTransferRequests.findOne({ id });
    if (!request) throw new ZiteError({ code: 'NOT_FOUND', message: 'Transfer request not found' });
    if ((request.status as string) !== 'Pending') throw new ZiteError({ code: 'CONFLICT', message: 'Request already reviewed' });

    // Authorization: only guides of the receiving residency (toResidency) or Super Guide can approve
    const isSuperGuide = context.user.role === 'Super Guide';
    if (!isSuperGuide) {
      const guideRecord = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id', 'folkResidencies'] });
      if (!guideRecord) throw new ZiteError({ code: 'FORBIDDEN', message: 'You are not a guide' });

      const guideResidencies = Array.isArray(guideRecord.folkResidencies) ? guideRecord.folkResidencies : guideRecord.folkResidencies ? [guideRecord.folkResidencies] : [];
      const toResidencyId = Array.isArray(request.toResidency) ? request.toResidency[0] : request.toResidency as string;

      if (!toResidencyId || !guideResidencies.includes(toResidencyId)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides of the receiving residency can approve this transfer' });
      }
    }

    await ResidencyTransferRequests.update({
      id,
      record: {
        status: input.action === 'approve' ? 'Approved' : 'Rejected',
        resolvedAt: new Date().toISOString(),
        notes: input.notes || '',
      },
    });

    const userId = Array.isArray(request.user) ? request.user[0] : request.user as string;
    if (input.action === 'approve') {
      const newResidencyId = Array.isArray(request.toResidency) ? request.toResidency[0] : request.toResidency as string | null;
      if (userId) {
        if (newResidencyId) {
          await Users.update({ id: userId, record: { residency: newResidencyId, residencyApproved: true } });
        } else {
          // No target residency means leaving the residency
          await Users.update({
            id: userId,
            record: {
              residency: null,
              residencyApproved: false,
              residencyClaimed: false,
              isFolkLead: false,
            },
          });
        }
      }
    }

    if (userId) {
      serverCacheInvalidate(`user_profile:${userId}`);
    }

    return { success: true, message: `Residency transfer request ${input.action === 'approve' ? 'approved' : 'rejected'}` };
  },
});
