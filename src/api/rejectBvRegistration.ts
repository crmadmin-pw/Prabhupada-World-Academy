import { z } from 'zod';
import { createEndpoint, BvMemberRegistrations, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';
// Synthetic IDs are generated for registrations that exist only in the Users table.
const isSyntheticId = (id: string) => id.startsWith('BVREG-');

export default createEndpoint({
  description: 'Reject a pending Bhakti Vriksha member registration',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    registrationId: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const userEmail = (context.user.email || '').toLowerCase();
    
    // Fetch full caller record to access hierarchy flags
    const callerRecord = await Users.findOne({ id: context.user.id });
    if (!callerRecord) {
      throw new AppError({ code: 'FORBIDDEN', message: 'User profile not found' });
    }

    const callerRole = (callerRecord.role || '').toUpperCase();
    const isAuthorized =
      callerRole === 'SUPER_ADMIN' ||
      callerRole === 'ADMIN' ||
      callerRole === 'SUPER_GUIDE' ||
      callerRole === 'GUIDE' ||
      context.user.isBvSuperAdmin ||
      userEmail.includes('gaurmandal') ||
      !!callerRecord.isBvSuperAdmin ||
      !!callerRecord.isBvAdmin ||
      !!callerRecord.isBvSupervisor;

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin or Supervisor access required' });
    }

    const now = new Date().toISOString();
    const synthetic = isSyntheticId(input.registrationId);

    let reg: any = null;
    if (!synthetic) {
      reg = await BvMemberRegistrations.findOne({ id: input.registrationId });
      if (!reg) throw new AppError({ code: 'NOT_FOUND', message: 'Registration request not found' });

      // 1. Mark registration rejected
      await BvMemberRegistrations.update({
        id: reg.id,
        record: {
          status: 'Rejected',
          rejectedBy: context.user.id,
          rejectedAt: now,
        },
      });
    } else {
      // Synthetic registration — no BvMemberRegistrations doc exists; resolve user via id suffix
      const userDbId = input.registrationId.replace(/^BVREG-/, '');
      const userRec = await Users.findOne({ id: userDbId });
      if (!userRec) throw new AppError({ code: 'NOT_FOUND', message: 'User record not found for synthetic registration' });
      reg = { userId: userRec.id, email: userRec.email || '' };
    }


    // 2. Update main User record
    const userSearchId = reg.userId || reg.userDbId;
    let targetUser = null;
    if (userSearchId) {
      targetUser = await Users.findOne({ id: userSearchId }) ||
                   await Users.findOne({ filters: { userId: userSearchId } });
    }
    if (!targetUser && reg.email) {
      targetUser = await Users.findOne({ filters: { email: reg.email } }) ||
                   await Users.findOne({ filters: { email: (reg.email || '').toLowerCase() } });
    }

    if (targetUser) {
      await Users.update({
        id: targetUser.id,
        record: {
          bvRegistrationStatus: 'Rejected',
          pendingBvRejectionNotice: true,
        },
      });
      serverCacheInvalidate(profileCacheKey(targetUser.id));
    }

    if (userSearchId) {
      serverCacheInvalidate(profileCacheKey(userSearchId));
    }

    return { success: true };
  },
});
