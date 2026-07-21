import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Tag or untag a user as BV Supervisor — Admin, Super Admin, or Guide access',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
    guideId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    const isAuthorized = role === 'SUPER_GUIDE' || role === 'GUIDE' || context.user.isBvAdmin || context.user.isBvSuperAdmin;
    if (!isAuthorized) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Admin or Guide access required to manage Supervisors' });
    }

    const userRecord = await Users.findOne({ id: input.userId, fields: ['id'] });
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const shouldTag = input.action === 'tag';
    const updateData: Record<string, any> = { 
      isBvSupervisor: shouldTag,
      isBvMentor: shouldTag, // Backward compatibility
    };
    if (shouldTag) {
      updateData.bvSupervisorGuideId = input.guideId || context.user.id;
    } else {
      updateData.bvSupervisorGuideId = '';
    }

    await Users.update({ id: userRecord.id, record: updateData });
    serverCacheInvalidate(profileCacheKey(input.userId));

    return { success: true };
  },
});
