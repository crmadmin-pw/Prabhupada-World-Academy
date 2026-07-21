import { z } from 'zod';
import { createEndpoint, BvMemberRegistrations, BvGroupMembers, Users, BvGroups, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Approve pending Bhakti Vriksha member registration and assign them to a Reading Group — Admin or Supervisor access',
  authenticated: true,
  inputSchema: z.object({
    registrationId: z.string(),
    groupId: z.string(),
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

    const group = await BvGroups.findOne({ id: input.groupId });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Selected Reading Group not found' });

    const now = new Date().toISOString();

    // 1. Mark registration approved
    await BvMemberRegistrations.update({
      id: reg.id,
      record: {
        status: 'Approved',
        assignedGroupId: group.id,
        assignedGroupName: group.groupName || '',
        approvedBy: context.user.id,
        approvedAt: now,
      },
    });

    // 2. Add member to group
    const memberRecordId = `BVMEM-${reg.userId}-${group.id}`;
    const existingMember = await BvGroupMembers.findOne({ id: memberRecordId }).catch(() => null);
    if (!existingMember) {
      await BvGroupMembers.create({
        record: {
          id: memberRecordId,
          groupId: group.id,
          userId: reg.userId,
          role: 'Member',
          joinedAt: now,
        },
      });
    }

    // 3. Update main User record
    await Users.update({
      id: reg.userId,
      record: {
        bvRegistrationStatus: 'Approved',
        bvGroupId: group.id,
        bvGroupName: group.groupName || '',
      },
    }).catch(() => {});

    serverCacheInvalidate(profileCacheKey(reg.userId));

    return { success: true };
  },
});
