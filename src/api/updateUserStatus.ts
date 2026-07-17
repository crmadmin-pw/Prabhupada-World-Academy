import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Guide activates or deactivates a user account — center-based access',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    status: z.enum(['Active', 'Inactive']),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isSuperGuide = role === 'Super Guide';
    const isAuthorized = ['Super Guide', 'Guide', 'BVSL', 'Sadhana Mentor'].includes(role);
    if (!isAuthorized) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });

    // Regular guides: verify user is in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });

      const userRecord = await Users.findOne({
        id: input.userId,
        fields: ['id', 'residency', 'guide'],
      });
      if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only update status for users in your center' });
      }
    }

    const today = getTodayIST();
    await Users.update({
      id: input.userId,
      record: { status: input.status, statusChangedAt: today },
    });
    serverCacheInvalidate(profileCacheKey(input.userId));

    return { success: true };
  },
});
