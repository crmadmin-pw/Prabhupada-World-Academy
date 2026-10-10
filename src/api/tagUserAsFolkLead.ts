import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';

export default createEndpoint({
  description: 'Tag/untag a user as FOLK Lead',
  authenticated: true,
  requiredCapabilities: 'roles.assign',
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
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
      callerRole.includes('GUIDE')
    );
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    let userRecord = await Users.findOne({ id: input.userId, fields: ['id', 'residency', 'residencyApproved', 'guide'] });
    if (!userRecord) {
      userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ['id', 'residency', 'residencyApproved', 'guide'] });
    }
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });

    if (input.action === 'tag') {
      const residencyId = Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency;
      const isResident = !!(userRecord.residencyApproved && residencyId);
      if (!isResident) {
        throw new AppError({
          code: 'BAD_REQUEST',
          message: 'Only approved residents of a FOLK residency can be assigned the FOLK Lead role.'
        });
      }
    }

    const isSuperGuide = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN')
    );

    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only tag users in your center' });
      }
    }

    const shouldTag = input.action === 'tag';
    await Users.update({ id: userRecord.id, record: {
      isFolkLead: shouldTag,
      pendingRoleNotice: shouldTag ? 'Assigned role: FOLK Lead' : 'Removed role: FOLK Lead',
      roleNoticeAcknowledged: false,
    } as any });
    serverCacheInvalidate('user_profile:' + userRecord.id);
    await publishUsersRevision(userRecord.id);
    return { success: true };
  },
});
