import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwTarget } from '@/lib/pwSadhana';
import { serverCacheInvalidate } from '@/lib/serverCache';

export default createEndpoint({
  description: 'Assign a Prabhupada World member their chanting rounds and reading minutes',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    userId: z.string().min(1),
    chantingRounds: z.number().int().min(0).max(192).nullable(),
    readingMinutes: z.number().int().min(0).max(1440).nullable(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    pwChantingTarget: z.number().nullable(),
    pwReadingTarget: z.number().nullable(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isRgf = !!(context.user.isBvFacilitator || context.user.isBvsl);
    const isAdmin = !!(context.user.isBvAdmin || context.user.isBvSuperAdmin);
    if (!isRgf && !isAdmin) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a reading group facilitator can assign sadhana targets' });
    }

    const fields = ['id', 'userId', 'email', 'segment', 'isPrabhupadaWorldUser', 'role', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvAdmin'];
    const member = await Users.findOne({ id: input.userId, fields })
      || await Users.findOne({ filters: { userId: input.userId }, fields })
      || await Users.findOne({ filters: { email: String(input.userId).toLowerCase() }, fields });
    if (!member) throw new AppError({ code: 'NOT_FOUND', message: 'Member not found' });
    if (!isPwSadhanaUser(member)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Sadhana targets apply only to Prabhupada World members' });
    }

    const scope = await getScopedHierarchyUserIds(context.user);
    if (!isUserInHierarchy(member, scope)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can only assign sadhana for your own members' });
    }

    const pwChantingTarget = pwTarget(input.chantingRounds);
    const pwReadingTarget = pwTarget(input.readingMinutes);
    await Users.update({
      id: member.id,
      record: { pwChantingTarget, pwReadingTarget },
    });
    serverCacheInvalidate('bvslMembers:');
    return { success: true, pwChantingTarget, pwReadingTarget };
  },
});
