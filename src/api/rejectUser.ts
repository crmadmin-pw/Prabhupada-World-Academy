import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Reject a user application — center-based access',
  authenticated: true,
  requiredCapabilities: 'users.approve',
  inputSchema: z.object({
    userId: z.string(),
    rowId: z.any().optional(),
    rejectedBy: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');

    // Keep rejection authorization identical to approval authorization.  In
    // particular, PW admins can see the PW approval queue, but the former
    // role-string-only check below then treated them as ordinary guides and
    // rejected the request for lacking a FOLK guide scope.
    const normalizedRole = String(context.user.normalizedRole || context.user.role || '')
      .trim()
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
    const isSuperGuide = normalizedRole === 'SUPER_GUIDE';

    const userFields = ['id', 'userId', 'email', 'residency', 'guide', 'segment', 'isPrabhupadaWorldUser'];
    const userRecord = await Users.findOne({ id: input.userId, fields: userFields }) ||
      await Users.findOne({ filters: { userId: input.userId }, fields: userFields }) ||
      await Users.findOne({ filters: { email: input.userId }, fields: userFields }) ||
      await Users.findOne({ filters: { email: String(input.userId).toLowerCase() }, fields: userFields });
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });

    const isPwUser = userRecord.segment === 'PW' || !!userRecord.isPrabhupadaWorldUser;
    const isPwAdmin = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'PW_ADMIN'
    );
    const canRejectPwUser = isPwUser && (
      context.user.isBvSuperAdmin ||
      (isPwAdmin && String(context.user.segment || '').toUpperCase() === 'PW')
    );

    if (!isSuperGuide && !canRejectPwUser) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });

      // Verify the user belongs to this guide's center
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only reject users in your center' });
      }
    }

    await Users.update({ id: userRecord.id, record: { status: 'Rejected' } });
    serverCacheInvalidate(profileCacheKey(userRecord.id));
    return { success: true };
  },
});
