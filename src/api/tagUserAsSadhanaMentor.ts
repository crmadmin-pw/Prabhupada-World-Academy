import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Tag/untag a user as Sadhana Mentor — center-based access',
  authenticated: true,
  requiredCapabilities: 'sadhana.mentor.assign',
  inputSchema: z.object({
    userId: z.string(),
    isMentor: z.boolean().optional(),
    action: z.enum(['tag', 'untag']).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = (context.user.role || '').toUpperCase();
    const isAuthorized = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN') ||
      callerRole.includes('GUIDE') ||
      callerRole.includes('BVSL')
    );
    if (!isAuthorized) throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });

    // Resolve the user record (primary path: DB UUID)
    let userRecord = await Users.findOne({
      id: input.userId,
      fields: ['id', 'role', 'isBvsl', 'residency', 'guide'],
    });
    if (!userRecord) {
      userRecord = await Users.findOne({
        filters: { userId: input.userId },
        fields: ['id', 'role', 'isBvsl', 'residency', 'guide'],
      });
    }
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: `User ${input.userId} not found` });

    const isSuperGuide = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN')
    );

    // Regular guides: verify user is in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only tag users in your center' });
      }
    }

    const shouldTag = input.isMentor ?? (input.action === 'tag');
    const existingIsBvsl = !!(userRecord.isBvsl);
    const newRole = shouldTag
      ? (existingIsBvsl ? 'BVSL' : 'Sadhana Mentor')
      : (existingIsBvsl ? 'BVSL' : 'User');

    const updates: any = { role: newRole, isSadhanaMentor: shouldTag };
    updates.pendingRoleNotice = shouldTag ? 'Assigned role: Sadhana Mentor' : 'Removed role: Sadhana Mentor';
    updates.roleNoticeAcknowledged = false;

    await Users.update({
      id: userRecord.id,
      record: updates,
    });
    serverCacheInvalidate('user_profile:' + userRecord.id);
    return { success: true };
  },
});
