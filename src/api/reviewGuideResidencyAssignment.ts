import { z } from 'zod';
import { createEndpoint, GuideResidencyAssignmentRequests, Guides, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

const roleName = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
const ids = (value: unknown): string[] => (Array.isArray(value) ? value : value == null ? [] : [value]).map(v => String(v || '').trim()).filter(Boolean);

export default createEndpoint({
  description: 'Approve or reject a FOLK guide residency assignment request',
  authenticated: true,
  inputSchema: z.object({ requestId: z.string().min(1), action: z.enum(['approve', 'reject']), notes: z.string().max(1000).optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = roleName(context.user.role);
    if (!(role === 'SUPER_GUIDE' || role === 'SUPER_ADMIN' || context.user.isBvSuperAdmin === true)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }
    const request = await GuideResidencyAssignmentRequests.findOne({ id: input.requestId });
    if (!request) throw new AppError({ code: 'NOT_FOUND', message: 'Residency assignment request not found' });
    if (request.status !== 'Pending') throw new AppError({ code: 'CONFLICT', message: 'Request has already been reviewed' });

    const requestedIds = ids(request.requestedResidencyIds);
    if (input.action === 'approve') {
      let user = request.requesterId ? await Users.findOne({ id: request.requesterId }) : undefined;
      user = user || (request.requesterUserId ? await Users.findOne({ filters: { userId: request.requesterUserId } }) : undefined);
      user = user || (request.requesterEmail ? await Users.findOne({ filters: { email: request.requesterEmail } }) : undefined);
      if (!user) throw new AppError({ code: 'NOT_FOUND', message: 'Guide profile not found' });

      await Users.update({ id: user.id, record: { folkResidencies: requestedIds } });
      const guide = request.requesterEmail
        ? await Guides.findOne({ filters: { email: request.requesterEmail, isActive: true } })
        : undefined;
      if (guide?.id) await Guides.update({ id: guide.id, record: { folkResidencies: requestedIds } });
      serverCacheInvalidate(`user_profile:${user.id}`);
    }

    await GuideResidencyAssignmentRequests.update({ id: input.requestId, record: {
      status: input.action === 'approve' ? 'Approved' : 'Rejected',
      reviewedAt: new Date().toISOString(),
      reviewedBy: context.user.id || context.user.email || '',
      reviewerName: context.user.fullName || context.user.email || '',
      reviewNotes: input.notes || '',
    } });
    return { success: true, status: input.action === 'approve' ? 'Approved' : 'Rejected' };
  },
});
