import { z } from 'zod';
import { createEndpoint, Users, BvGroupMembers, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { bvUserAliases, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { getScopedHierarchyUserIds, hierarchyAliases, isUserInHierarchy } from '../lib/hierarchyUtils';

const formatPhone = (phone?: string) => {
  if (!phone) return '';
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length > 10 && !phone.startsWith('+')) {
    return `+${phone}`;
  }
  return phone;
};

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  return value == null ? [] : [String(value).trim().toLowerCase()].filter(Boolean);
}

export default createEndpoint({
  description: 'Get members for BV groups the caller manages',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    guideId: z.string().optional(),
    bvslId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    const cacheKey = `bvslMembers:${input.bvslId || ''}:${context.user.id}`;
    return serverCacheGetOrFetch(cacheKey, () => fetchBvslMembers({ input, context }), 5 * 60 * 1000);
  },
});

async function resolveLeader(bvslId: string) {
  const fields = ['id', 'userId', 'email', 'role', 'fullName'];
  return await Users.findOne({ filters: { userId: bvslId }, fields }).catch(() => undefined)
    || await Users.findOne({ id: bvslId, fields }).catch(() => undefined)
    || await Users.findOne({ filters: { email: bvslId }, fields }).catch(() => undefined);
}

async function fetchBvslMembers({ input, context }: { input: any; context: any }) {
  const caller = context.user;
  const callerAliases = new Set(bvUserAliases(caller));
  const scope = await getScopedHierarchyUserIds(caller);
  const scopedGroups = await resolveBvScopedGroups(caller);

  let targetGroups = scopedGroups.filter(group =>
    refs([
      group.record.bvslLeader,
      group.record.bvslId,
      group.record.subFacilitatorId,
      group.record.rgsfId,
      group.record.subFacilitator,
    ]).some(alias => callerAliases.has(alias)),
  );

  if (input.bvslId) {
    const leader = await resolveLeader(String(input.bvslId));
    const leaderAliases = new Set(leader ? hierarchyAliases(leader) : []);
    const inChain = !!leader && (
      isUserInHierarchy(leader, scope) ||
      [...leaderAliases].some(alias => callerAliases.has(alias))
    );
    if (!inChain) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This group leader is outside your chain' });
    }
    targetGroups = scopedGroups.filter(group =>
      refs([group.record.bvslLeader, group.record.bvslId, group.record.subFacilitatorId, group.record.rgsfId, group.record.subFacilitator])
        .some(alias => leaderAliases.has(alias)),
    );
  }

  if (targetGroups.length === 0) return { members: [] };

  const ownGroupIds = new Set(targetGroups.filter(group =>
    refs([group.record.bvslLeader, group.record.bvslId, group.record.subFacilitatorId, group.record.rgsfId, group.record.subFacilitator])
      .some(alias => callerAliases.has(alias)),
  ).flatMap(group => refs([group.id, group.groupId])));

  const groupMap: Record<string, string> = {};
  const groupIdMap: Record<string, string> = {};
  targetGroups.forEach(group => {
    groupMap[group.id] = group.groupName;
    groupIdMap[group.id] = group.groupId;
    if (group.groupId) {
      groupMap[group.groupId] = group.groupName;
      groupIdMap[group.groupId] = group.groupId;
    }
  });

  const groupIds = targetGroups.map(group => group.id);
  const targetGroupKeys = [...new Set(targetGroups.flatMap(group => [group.id, group.groupId].filter(Boolean)))];
  const { records: memberships } = await BvGroupMembers.findAll({
    filters: { group: { in: groupIds } },
    fields: ['id', 'user', 'group'],
    limit: 500,
  });
  const { records: membershipsByGroupId } = await BvGroupMembers.findAll({
    filters: { groupId: { in: targetGroupKeys } } as any,
    fields: ['id', 'user', 'userId', 'group', 'groupId'],
    limit: 1000,
  }).catch(() => ({ records: [] }));
  const membershipMap = new Map<string, any>();
  [...memberships, ...membershipsByGroupId].forEach((membership: any) => membershipMap.set(String(membership.id), membership));
  const allMemberships = [...membershipMap.values()];

  const userIds = [...new Set(allMemberships.flatMap((m: any) => [m.user, m.userId]).flatMap((value: any) => Array.isArray(value) ? value : [value]).filter(Boolean))] as string[];
  let memberUsers: any[] = [];
  if (userIds.length > 0) {
    const userQueries = await Promise.all([
      Users.findAll({ filters: { id: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
      Users.findAll({ filters: { userId: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
      Users.findAll({ filters: { email: { in: userIds } } as any, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'email', 'residency', 'residencyApproved', 'role', 'roles', 'isRgsf', 'pwChantingTarget', 'pwReadingTarget'], limit: 500 }).catch(() => ({ records: [] })),
    ]);
    const uniqueUsers = new Map<string, any>();
    userQueries.flatMap(result => result.records || []).forEach((user: any) => uniqueUsers.set(String(user.id), user));
    memberUsers = [...uniqueUsers.values()];
  }

  const userMap: Record<string, any> = {};
  memberUsers.forEach((u: any) => {
    [u.id, u.userId, u.email].filter(Boolean).forEach((key: any) => { userMap[String(key).toLowerCase()] = u; });
  });

  const residencyIds = [...new Set(memberUsers.map((u: any) => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean))] as string[];
  const residencyMap: Record<string, string> = {};
  if (residencyIds.length > 0) {
    const { records: residencies } = await FolkResidencies.findAll({ filters: { id: { in: residencyIds } }, fields: ['id', 'residencyName'], limit: 100 });
    residencies.forEach((r: any) => { residencyMap[r.id] = (r.residencyName as string) || ''; });
  }

  const callerId = String(caller.id || '').toLowerCase();
  const callerUserId = String(caller.userId || '').toLowerCase();
  const callerEmail = String(caller.email || '').toLowerCase();

  const members = allMemberships.map((m: any) => {
    const uid = Array.isArray(m.user) ? m.user[0] : m.user as string;
    const gid = Array.isArray(m.group) ? m.group[0] : (m.group || (Array.isArray(m.groupId) ? m.groupId[0] : m.groupId)) as string;
    const u = userMap[String(uid || '').toLowerCase()] as any;
    if (!u) return null;

    const uId = String(u.id || '').toLowerCase();
    const uUserId = String(u.userId || '').toLowerCase();
    const uEmail = String(u.email || '').toLowerCase();
    if (uId === callerId || uUserId === callerUserId || (callerEmail && uEmail === callerEmail)) return null;

    const uRole = (u.role || '').toUpperCase();
    if (u.isBvSuperAdmin || uRole === 'SUPER ADMIN' || uRole === 'SUPER_ADMIN') return null;

    const showContacts = refs(gid).some(alias => ownGroupIds.has(alias));
    const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
    return {
      userId: u.userId || uid || '',
      fullName: (u.fullName as string) || '',
      phone: showContacts ? formatPhone(u.phone) : '',
      ashrayLevel: (u.ashrayLevel as string) || null,
      email: showContacts ? ((u.email as string) || '') : '',
      groupName: groupMap[gid] || '',
      groupId: groupIdMap[gid] || '',
      isResident: !!(u.residencyApproved && residencyId),
      residencyName: residencyId ? (residencyMap[residencyId] || null) : null,
      isRgsf: !!(u.isRgsf || u.role === 'RGSF' || (Array.isArray(u.roles) && u.roles.includes('RGSF'))),
      pwChantingTarget: u.pwChantingTarget ?? null,
      pwReadingTarget: u.pwReadingTarget ?? null,
    };
  }).filter(member => member !== null);

  return { members };
}
