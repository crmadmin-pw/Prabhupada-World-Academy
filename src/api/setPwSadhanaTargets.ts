import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroups, Users, AppError } from '@/lib/backend-sdk';
import { bvGroupDepartment } from '@/lib/bvGroupName';
import { bvUserAliases } from '@/lib/bvGroupMemberScope';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwTarget, pwTime, readPwTargets } from '@/lib/pwSadhana';
import { canSetPwTargets, isPwAdmin, isPwRgf } from '@/lib/pwTargetResolver';
import { serverCacheInvalidate } from '@/lib/serverCache';

const MEMBER_FIELDS = ['id', 'userId', 'email', 'fullName', 'segment', 'isPrabhupadaWorldUser', 'role',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor',
  'isBvMember', 'isRgsf', 'isSadhanaMentor', 'bvGroupId', 'sadhanaMentor', 'ashrayLevel',
  'pwTargets', 'pwChantingTarget', 'pwReadingTarget',
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

const optionalMinutes = z.number().int().min(0).max(1440).nullable().optional();

export default createEndpoint({
  description: 'Assign a Prabhupada World member the sadhana targets their role allows',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().min(1),
    chantingRounds: z.number().int().min(0).max(192).nullable().optional(),
    readingMinutes: optionalMinutes,
    wakeUp: z.string().nullable().optional(),
    sleep: z.string().nullable().optional(),
    hearingMinutes: optionalMinutes,
    sevaMinutes: optionalMinutes,
  }),
  outputSchema: z.object({
    success: z.boolean(),
    pwChantingTarget: z.number().nullable(),
    pwReadingTarget: z.number().nullable(),
    pwTargets: z.any(),
    source: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isRgf = isPwRgf(context.user);
    const isAdmin = isPwAdmin(context.user);
    const isMentor = !!(context.user.isSadhanaMentor);
    if (!isRgf && !isAdmin && !isMentor) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a reading group facilitator, admin, or sadhana mentor can assign sadhana targets' });
    }

    const found = await Users.findOne({ id: input.userId, fields: MEMBER_FIELDS })
      || await Users.findOne({ filters: { userId: input.userId }, fields: MEMBER_FIELDS })
      || await Users.findOne({ filters: { email: String(input.userId).toLowerCase() }, fields: MEMBER_FIELDS });
    if (!found) throw new AppError({ code: 'NOT_FOUND', message: 'Member not found' });
    const profiles = await relatedProfiles(found);
    const member = profiles.find(profile => profile.id && profile.userId && profile.id !== profile.userId) || found;
    const inGroup = await memberInAssignableGroup(profiles);
    if (!profiles.some(isPwSadhanaUser) && !inGroup) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Sadhana targets apply only to Prabhupada World members' });
    }

    const scope = await getScopedHierarchyUserIds(context.user);
    if (!isUserInHierarchy(member, scope)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can only assign sadhana for your own members' });
    }

    const inBvGroup = inGroup || profiles.some(profile => profile.isBvMember || profile.bvGroupId || profile.isBvSubFacilitator || profile.isRgsf);
    const permission = canSetPwTargets(context.user, member, inBvGroup);
    if (!permission.allowed) {
      throw new AppError({ code: 'FORBIDDEN', message: permission.message });
    }

    const next = readPwTargets(member.pwTargets);
    if (next.chanting == null) next.chanting = pwTarget(member.pwChantingTarget);
    if (next.readingMin == null) next.readingMin = pwTarget(member.pwReadingTarget);
    if (input.chantingRounds !== undefined) next.chanting = pwTarget(input.chantingRounds);
    if (input.readingMinutes !== undefined) next.readingMin = pwTarget(input.readingMinutes);
    if (input.wakeUp !== undefined) next.wakeUp = pwTime(input.wakeUp);
    if (input.sleep !== undefined) next.sleep = pwTime(input.sleep);
    if (input.hearingMinutes !== undefined) next.hearingMin = pwTarget(input.hearingMinutes);
    if (input.sevaMinutes !== undefined) next.sevaMin = pwTarget(input.sevaMinutes);
    const pwTargets = {
      ...next,
      setBy: context.user.id || context.user.userId || '',
      setByRole: permission.source,
      updatedAt: new Date().toISOString(),
    };
    await Users.update({
      id: member.id,
      record: {
        pwChantingTarget: next.chanting,
        pwReadingTarget: next.readingMin,
        pwTargets,
        // Keep the profile aligned with the reading group so later sadhana
        // scoring sees the same department this target was saved for.
        ...(!isPwSadhanaUser(member) ? { segment: 'PW', isPrabhupadaWorldUser: true } : {}),
      },
    });
    serverCacheInvalidate('bvslMembers:');
    return { success: true, pwChantingTarget: next.chanting, pwReadingTarget: next.readingMin, pwTargets, source: permission.source };
  },
});
