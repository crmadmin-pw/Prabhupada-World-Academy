import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroups, Users, AppError } from '@/lib/backend-sdk';
import { bvGroupDepartment } from '@/lib/bvGroupName';
import { bvUserAliases } from '@/lib/bvGroupMemberScope';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwTarget } from '@/lib/pwSadhana';
import { serverCacheInvalidate } from '@/lib/serverCache';

const MEMBER_FIELDS = ['id', 'userId', 'email', 'fullName', 'segment', 'isPrabhupadaWorldUser', 'role',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvAdmin',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

function rawIdentity(user: any): string[] {
  return [...new Set(bvUserAliases(user).concat(
    ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'memberId']
      .flatMap(field => {
        const value = user?.[field];
        return (Array.isArray(value) ? value : [value]).map(item => String(item || '').trim());
      }),
  ).filter(Boolean))];
}

async function relatedProfiles(member: any): Promise<any[]> {
  const seeds = [member?.id, member?.userId, member?.email].filter(Boolean).map(value => String(value).trim());
  const people = new Map<string, any>();
  if (member?.id) people.set(String(member.id), member);
  for (const seed of seeds) {
    const [byId, byUserId, byEmail] = await Promise.all([
      Users.findOne({ id: seed, fields: MEMBER_FIELDS }),
      Users.findAll({ filters: { userId: seed }, fields: MEMBER_FIELDS, limit: 5 }),
      seed.includes('@')
        ? Users.findAll({ filters: { email: seed.toLowerCase() }, fields: MEMBER_FIELDS, limit: 5 })
        : Promise.resolve({ records: [] }),
    ]);
    if (byId) people.set(String(byId.id), byId);
    for (const row of [...(byUserId.records || []), ...(byEmail.records || [])]) {
      if (row?.id) people.set(String(row.id), row);
    }
  }
  return [...people.values()];
}

/** Older membership rows store a sign-in id, and some profiles never received
 * segment or isPrabhupadaWorldUser. The member list still shows them. */
async function memberInAssignableGroup(people: any[]): Promise<boolean> {
  const keys = [...new Set(people.flatMap(rawIdentity))];
  if (keys.length === 0) return false;
  const aliasSet = new Set(keys.map(key => key.toLowerCase()));
  const memberships: any[] = [];
  for (let index = 0; index < keys.length; index += 10) {
    const chunk = keys.slice(index, index + 10);
    const pages = await Promise.all(['user', 'userId', 'memberId'].map(field =>
      BvGroupMembers.findAll({
        filters: { [field]: { in: chunk } } as any,
        fields: ['user', 'userId', 'memberId', 'group', 'groupId'],
        limit: 30,
      }),
    ));
    pages.forEach(page => memberships.push(...(page.records || [])));
  }
  const matched = memberships.filter(membership =>
    [membership.user, membership.userId, membership.memberId]
      .flat()
      .some(value => aliasSet.has(String(value || '').trim().toLowerCase())),
  );
  const groupKeys = [...new Set(matched.flatMap(membership =>
    [membership.group, membership.groupId].flat().map(value => String(value || '').trim()).filter(Boolean),
  ))];
  if (groupKeys.length === 0) return false;
  const groups: any[] = [];
  for (let index = 0; index < groupKeys.length; index += 10) {
    const chunk = groupKeys.slice(index, index + 10);
    const [byId, byGroupId] = await Promise.all([
      BvGroups.findAll({ filters: { id: { in: chunk } } as any, fields: ['id', 'groupId', 'segment'], limit: 20 }),
      BvGroups.findAll({ filters: { groupId: { in: chunk } } as any, fields: ['id', 'groupId', 'segment'], limit: 20 }),
    ]);
    groups.push(...(byId.records || []), ...(byGroupId.records || []));
  }
  // A group with no department still belongs to this RGF's reading groups.
  // Only an explicit FOLK group is out of scope for these targets.
  return groups.some(group => bvGroupDepartment(group.segment) !== 'FOLK');
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

    const found = await Users.findOne({ id: input.userId, fields: MEMBER_FIELDS })
      || await Users.findOne({ filters: { userId: input.userId }, fields: MEMBER_FIELDS })
      || await Users.findOne({ filters: { email: String(input.userId).toLowerCase() }, fields: MEMBER_FIELDS });
    if (!found) throw new AppError({ code: 'NOT_FOUND', message: 'Member not found' });
    const profiles = await relatedProfiles(found);
    const member = profiles.find(profile => profile.id && profile.userId && profile.id !== profile.userId) || found;
    const inAssignableGroup = profiles.some(isPwSadhanaUser) || await memberInAssignableGroup(profiles);
    if (!inAssignableGroup) {
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
