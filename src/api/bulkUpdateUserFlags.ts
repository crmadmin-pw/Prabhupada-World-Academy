import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Bulk update isB or isOtherCenter flag for multiple users — Guide/Super Guide/BVSL only',
  authenticated: true,
  inputSchema: z.object({
    userIds: z.array(z.string()).min(1).max(200),
    flag: z.enum(['isB', 'isOtherCenter']),
    value: z.boolean(),
  }),
  outputSchema: z.object({ updated: z.number() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const isSuperGuide = callerRole === 'Super Guide';
    const isAuthorized = isSuperGuide || callerRole === 'Guide' || callerRole === 'BVSL';
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    // For non-super-guides, get scope once upfront
    let scope: import('../lib/guideScope').GuideScope | null = null;
    if (!isSuperGuide) {
      scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide record not found' });
    }

    // Fetch all user records in parallel to verify scope
    const userRecords = await Promise.all(
      input.userIds.map(id =>
        Users.findOne({ id, fields: ['id', 'residency', 'guide'] })
      )
    );

    const validUsers = isSuperGuide
      ? userRecords.filter((u): u is NonNullable<typeof u> => !!u)
      : userRecords.filter((u): u is NonNullable<typeof u> => !!u && !!scope && isUserInGuideScope(scope, u));

    if (validUsers.length === 0) return { updated: 0 };

    // Update all valid users in parallel
    await Promise.all(
      validUsers.map(u =>
        Users.update({ id: u.id, record: { [input.flag]: input.value } as any })
      )
    );

    return { updated: validUsers.length };
  },
});
