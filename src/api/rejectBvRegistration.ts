import { z } from 'zod';
import { createEndpoint, BvMemberRegistrations, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Reject a pending Bhakti Vriksha member registration',
  authenticated: true,
  inputSchema: z.object({
    registrationId: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    const userEmail = (context.user.email || '').toLowerCase();
    const isAuthorized = role === 'SUPER_GUIDE' || role === 'GUIDE' || userEmail === 'srilaprabhupadaworld@gmail.com' || context.user.isBvAdmin || context.user.isBvSuperAdmin || context.user.isBvSupervisor;
    if (!isAuthorized) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Admin or Supervisor access required' });
    }

    const reg = await BvMemberRegistrations.findOne({ id: input.registrationId });
    if (!reg) throw new ZiteError({ code: 'NOT_FOUND', message: 'Registration request not found' });

    const now = new Date().toISOString();

    // 1. Mark registration rejected
    await BvMemberRegistrations.update({
      id: reg.id,
      record: {
        status: 'Rejected',
        rejectedBy: context.user.id,
        rejectedAt: now,
      },
    });

    // 2. Update main User record
    await Users.update({
      id: reg.userId,
      record: {
        bvRegistrationStatus: 'Rejected',
        pendingBvRejectionNotice: true,
      },
    }).catch(() => {});

    serverCacheInvalidate(profileCacheKey(reg.userId));

    return { success: true };
  },
});
