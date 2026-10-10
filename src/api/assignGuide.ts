import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';
import { resolveGuideReference } from '../lib/guideResolution';

export default createEndpoint({
  description: 'Reassign a user to a different guide — Super Guides can do this for anyone; regular guides can do this for users in their center',
  authenticated: true,
  requiredCapabilities: 'users.approve',
  inputSchema: z.object({
    userId: z.string(),
    newGuideId: z.string().optional(),
    guideId: z.string().optional(), // legacy alias for newGuideId
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = (context.user.role || '').toUpperCase();
    const isSuperGuide = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN') ||
      callerRole === 'SUPER GUIDE'
    );
    const isGuide = isSuperGuide || callerRole.includes('GUIDE');

    if (!isSuperGuide && !isGuide) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    // Fetch the target user record first to resolve their actual id (email) and userId
    const targetUserRecord = await Users.findOne({ id: input.userId }) ||
                             await Users.findOne({ filters: { userId: input.userId } });
    if (!targetUserRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });

    // Regular guides can only reassign users in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, targetUserRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only reassign users in your center' });
      }
    }

    const targetGuideId = input.newGuideId || input.guideId || '';
    
    const newGuide = await resolveGuideReference(targetGuideId);
    const resolvedGuideId = newGuide?.id || '';

    if (!resolvedGuideId) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Guide not found' });
    }

    await Users.update({ id: targetUserRecord.id, record: { guide: resolvedGuideId } });

    if (targetUserRecord.id) {
      serverCacheInvalidate('user_profile:' + targetUserRecord.id);
      serverCacheInvalidate('user_profile:' + targetUserRecord.id.toLowerCase());
    }
    if (targetUserRecord.userId) {
      serverCacheInvalidate('user_profile:' + targetUserRecord.userId);
    }
    await publishUsersRevision(targetUserRecord.id, targetUserRecord);
    return { success: true };
  },
});
