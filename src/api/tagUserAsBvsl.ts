import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';
import { publishUsersRevision } from '../lib/publishUsersRevision';

export default createEndpoint({
  description: 'Tag/untag a user as BVSL — center-based access',
  authenticated: true,
  requiredCapabilities: 'bv.roles.assign',
  inputSchema: z.object({
    userId: z.string(),
    isBvsl: z.boolean().optional(),
    action: z.enum(['tag', 'untag']).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = (context.user.role || '').toUpperCase();
    const isSuperAdmin = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      callerRole.includes('SUPER') ||
      callerRole.includes('ADMIN')
    );
    const isBvMentor = !!(context.user as any).isBvMentor;
    const isAuthorized = isSuperAdmin || callerRole.includes('GUIDE') || callerRole.includes('BVSL') || isBvMentor;
    if (!isAuthorized) throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });

    // Resolve the user record (primary path: DB UUID)
    let userRecord = await Users.findOne({
      id: input.userId,
      fields: ['id', 'role', 'isSadhanaMentor', 'residency', 'guide'],
    });
    if (!userRecord) {
      userRecord = await Users.findOne({
        filters: { userId: input.userId },
        fields: ['id', 'role', 'isSadhanaMentor', 'residency', 'guide'],
      });
    }
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: `User ${input.userId} not found` });

    // Regular guides: verify user is in their center (BV Mentors get full access like Super Guide)
    if (!isSuperAdmin && !isBvMentor) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only tag users in your center' });
      }
    }

    const shouldTag = input.isBvsl ?? (input.action === 'tag');
    const existingIsMentor = !!(userRecord.isSadhanaMentor);
    const newRole = shouldTag ? 'BVSL' : (existingIsMentor ? 'Sadhana Mentor' : 'User');

    await Users.update({
      id: userRecord.id,
      record: {
        role: newRole,
        isBvsl: shouldTag,
        bvServiceAllocated: shouldTag,
        pendingRoleNotice: shouldTag ? 'Assigned role: RGF' : 'Removed role: RGF',
        roleNoticeAcknowledged: false,
      },
    });

    serverCacheInvalidate('user_profile:');
    await publishUsersRevision(userRecord.id);
    return { success: true };
  },
});
