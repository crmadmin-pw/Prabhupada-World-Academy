import { z } from 'zod';
import { createEndpoint, GuideTransferRequests, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Approve or reject a guide transfer request — only the receiving guide can act',
  authenticated: true,
  inputSchema: z.object({
    requestId: z.string().optional(),
    logId: z.string().optional(),
    action: z.enum(['approve', 'reject']),
    notes: z.string().optional(),
    userId: z.string().optional(),
    guideId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const id = input.requestId || input.logId;
    if (!id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'requestId is required' });

    const request = await GuideTransferRequests.findOne({ id });
    if (!request) throw new ZiteError({ code: 'NOT_FOUND', message: 'Transfer request not found' });
    if ((request.status as string) !== 'Pending') throw new ZiteError({ code: 'CONFLICT', message: 'Request already reviewed' });

    // Authorization: only the receiving guide (toGuide) or Super Guide can approve
    const isSuperGuide = context.user.role === 'Super Guide';
    if (!isSuperGuide) {
      const guideRecord = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guideRecord) throw new ZiteError({ code: 'FORBIDDEN', message: 'You are not a guide' });

      const toGuideId = Array.isArray(request.toGuide) ? request.toGuide[0] : request.toGuide as string;
      if (!toGuideId || toGuideId !== guideRecord.id) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Only the receiving guide can approve this transfer' });
      }
    }

    await GuideTransferRequests.update({
      id,
      record: {
        status: input.action === 'approve' ? 'Approved' : 'Rejected',
        resolvedAt: new Date().toISOString(),
        notes: input.notes || '',
      },
    });

    const userId = Array.isArray(request.user) ? request.user[0] : request.user as string;
    if (input.action === 'approve') {
      const newGuideId = Array.isArray(request.toGuide) ? request.toGuide[0] : request.toGuide as string;
      if (userId && newGuideId) {
        await Users.update({ id: userId, record: { guide: newGuideId } });
      }
    }

    if (userId) {
      serverCacheInvalidate(`user_profile:${userId}`);
    }

    return { success: true, message: `Guide transfer request ${input.action === 'approve' ? 'approved' : 'rejected'}` };
  },
});
