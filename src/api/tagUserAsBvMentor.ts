import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Tag/untag a user as BV Mentor and assign their guide — Guide or Super Guide',
  authenticated: true,
  requiredCapabilities: 'bv.roles.assign',
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
    guideId: z.string().optional(), // Guides table record UUID (Super Guide only)
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    const isAuthorized = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      context.user.isBvMentor ||
      role.includes('SUPER') ||
      role.includes('ADMIN') ||
      role.includes('GUIDE')
    );
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Guide or Super Guide access required' });
    }

    const userRecord = await Users.findOne({ id: input.userId, fields: ['id'] });
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });

    const shouldTag = input.action === 'tag';
    const updateData: Record<string, any> = {
      isBvMentor: shouldTag,
      pendingRoleNotice: shouldTag ? 'Assigned role: BV Supervisor' : 'Removed role: BV Supervisor',
      roleNoticeAcknowledged: false,
    };
    if (shouldTag) {
      // Assign guideId or fallback to caller user id
      updateData.bvMentorGuideId = input.guideId || context.user.id;
    } else {
      updateData.bvMentorGuideId = '';
    }

    await Users.update({ id: userRecord.id, record: updateData });

    // Bust the profile cache so the user sees their new role on next load
    serverCacheInvalidate(profileCacheKey(input.userId));
    await publishUsersRevision(userRecord.id);
    return { success: true };
  },
});
