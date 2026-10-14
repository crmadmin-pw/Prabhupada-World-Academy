import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroups, Users, AppError } from '@/lib/backend-sdk';
import { bvGroupDepartment } from '@/lib/bvGroupName';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwTarget } from '@/lib/pwSadhana';
import { serverCacheInvalidate } from '@/lib/serverCache';

function identityKeys(user: any): string[] {
  return [...new Set([user?.id, user?.userId, user?.email]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

/** A member can be in a Prabhupada World reading group before their profile
 * stores segment or isPrabhupadaWorldUser. That profile gap is what the
 * target save used to reject. */
async function memberInPwGroup(member: any): Promise<boolean> {
  const keys = identityKeys(member);
  if (keys.length === 0) return false;
  const [byUser, byUserId, byMemberId] = await Promise.all([
    BvGroupMembers.findAll({ filters: { user: { in: keys } } as any, fields: ['group', 'groupId'], limit: 20 }),
    BvGroupMembers.findAll({ filters: { userId: { in: keys } } as any, fields: ['group', 'groupId'], limit: 20 }),
    BvGroupMembers.findAll({ filters: { memberId: { in: keys } } as any, fields: ['group', 'groupId'], limit: 20 }),
  ]);
  const groupKeys = [...new Set(
    [...byUser.records, ...byUserId.records, ...byMemberId.records]
      .flatMap((membership: any) => [membership.group, membership.groupId])
      .flatMap((value: unknown) => Array.isArray(value) ? value : [value])
      .map((value: unknown) => String(value || '').trim())
      .filter(Boolean),
  )];
  if (groupKeys.length === 0) return false;
  const [byId, byGroupId] = await Promise.all([
    BvGroups.findAll({ filters: { id: { in: groupKeys } } as any, fields: ['id', 'segment'], limit: 20 }),
    BvGroups.findAll({ filters: { groupId: { in: groupKeys } } as any, fields: ['id', 'groupId', 'segment'], limit: 20 }),
  ]);
  return [...byId.records, ...byGroupId.records].some((group: any) => bvGroupDepartment(group.segment) === 'PW');
}

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
    const caller = isPwSadhanaUser(context.user)
      ? context.user
      : await Users.findOne({ id: context.user.id, fields })
        || await Users.findOne({ filters: { userId: context.user.userId || context.user.id }, fields });
    const explicitlyFolk = bvGroupDepartment(member.segment) === 'FOLK';
    const inPwGroup = !isPwSadhanaUser(member) && await memberInPwGroup(member);
    if (!isPwSadhanaUser(member) && !inPwGroup && (explicitlyFolk || !isPwSadhanaUser(caller))) {
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
      record: {
        pwChantingTarget,
        pwReadingTarget,
        // Keep the profile aligned with the reading group so later sadhana
        // scoring sees the same department this target was saved for.
        ...(!isPwSadhanaUser(member) ? { segment: 'PW', isPrabhupadaWorldUser: true } : {}),
      },
    });
    serverCacheInvalidate('bvslMembers:');
    return { success: true, pwChantingTarget, pwReadingTarget };
  },
});
