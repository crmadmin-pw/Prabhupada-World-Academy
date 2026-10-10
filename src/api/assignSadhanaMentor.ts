import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';

export default createEndpoint({
  description: 'Assign a Sadhana Mentor to a user',
  authenticated: true,
  requiredCapabilities: 'sadhana.mentor.assign',
  inputSchema: z.object({
    userId: z.string(),
    sadhanaMentorId: z.string().optional().nullable(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = (context.user.role || '').toUpperCase();
    const isAuthorized = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN')
    );

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin access required' });
    }

    if (!input.sadhanaMentorId || input.sadhanaMentorId === '__unassigned__') {
      await Users.update({
        id: input.userId,
        record: { sadhanaMentor: null }
      });
    } else {
      const mentor = await Users.findOne({ id: input.sadhanaMentorId }) ??
                     await Users.findOne({ filters: { userId: input.sadhanaMentorId } });
      if (!mentor) throw new AppError({ code: 'NOT_FOUND', message: 'Sadhana Mentor not found' });

      await Users.update({
        id: input.userId,
        record: { sadhanaMentor: mentor.id }
      });
    }
    
    serverCacheInvalidate('user_profile:' + input.userId);
    await publishUsersRevision(input.userId);
    return { success: true };
  },
});

