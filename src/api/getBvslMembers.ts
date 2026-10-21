import { z } from 'zod';
import { createEndpoint, Users, BvGroupMembers, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { bvUserAliases, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { countsAsGroupMember, loadGroupFacilitators } from '@/lib/bvGroupFacilitators';
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

function isRgsfUser(user: any) {
  const role = String(user?.role || '').toUpperCase();
  return !!(user?.isBvSubFacilitator || role.includes('RGSF'));
}

function isFacilitatorUser(user: any) {
  const role = String(user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  return !!(user?.isBvFacilitator || user?.isBvsl || ['RGF', 'BVSL', 'FACILITATOR'].includes(role));
}

const MEMBER_FIELDS = [
  'id', 'userId', 'fullName', 'displayName', 'name', 'phone', 'ashrayLevel', 'email',
  'residency', 'residencyApproved', 'role', 'roles', 'status', 'isRgsf', 'isBvSuperAdmin',
  'isBvMember', 'bvGroupId', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'pwChantingTarget', 'pwReadingTarget', 'pwTargets',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

const MEMBER_LOOKUP_FIELDS = [
  'id', 'userId', 'email', 'phone', 'fullName', 'displayName', 'name',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

function storedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(storedValues);
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

/** Membership rows are not always the Users document id. Join approval stores
 * the Firebase auth id, and older imports store a display name or memberId. */
async function findMembersByAliases(aliases: string[]): Promise<any[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const text = String(alias || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  const results = new Map<string, any>();
  const remember = (pages: Array<{ records?: any[] }>) => {
    for (const page of pages) {
      for (const user of page.records || []) {
        const key = String(user.id || user.userId || user.email || '');
        if (key) results.set(key, user);
      }
    }
  };
  const lookup = async (values: string[], fields: string[]) => {
    if (values.length === 0 || fields.length === 0) return;
    for (let index = 0; index < values.length; index += 30) {
      const chunk = values.slice(index, index + 30);
      remember(await Promise.all(fields.map(field =>
        Users.findAll({
          filters: { [field]: { in: chunk } } as any,
          fields: MEMBER_FIELDS,
          limit: 500,
        }),
      )));
    }
  };

  const primary = ['id', 'userId', 'email'];
  await lookup(unique, primary);
  const covered = new Set<string>();
  for (const user of results.values()) bvUserAliases(user).forEach(alias => covered.add(alias));
  const unresolved = unique.filter(alias => !covered.has(alias.trim().toLowerCase()));
  const secondary = MEMBER_LOOKUP_FIELDS.filter(field => !primary.includes(field));
  await lookup(unresolved, secondary);
  return [...results.values()];
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
  return await Users.findOne({ filters: { userId: bvslId }, fields })
    || await Users.findOne({ id: bvslId, fields })
    || await Users.findOne({ filters: { email: bvslId }, fields });
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
    const viewingSelf = [...leaderAliases].some(alias => callerAliases.has(alias));
    // An RGSF-only dashboard asks for its own id, but its groups belong to the
    // reporting RGF. An RGF keeps the groups they facilitate, even when a stale
    // RGSF flag is still stored on the profile.
    targetGroups = viewingSelf && isRgsfUser(caller) && !isFacilitatorUser(caller)
      ? scopedGroups
      : scopedGroups.filter(group =>
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
    fields: ['id', 'user', 'userId', 'memberId', 'group'],
    limit: 500,
  });
  const { records: membershipsByGroupId } = await BvGroupMembers.findAll({
    filters: { groupId: { in: targetGroupKeys } } as any,
    fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
    limit: 1000,
  });
  const membershipMap = new Map<string, any>();
  [...memberships, ...membershipsByGroupId].forEach((membership: any) => membershipMap.set(String(membership.id), membership));
  const allMemberships = [...membershipMap.values()];

  const memberAliases = allMemberships.flatMap((m: any) => storedValues([m.user, m.userId, m.memberId]));
  const memberUsers = memberAliases.length > 0 ? await findMembersByAliases(memberAliases) : [];

  const userMap: Record<string, any> = {};
  memberUsers.forEach((u: any) => {
    bvUserAliases(u).forEach(key => { userMap[key] = u; });
  });

  const residencyIds = [...new Set(memberUsers.map((u: any) => Array.isArray(u.residency) ? u.residency[0] : u.residency).filter(Boolean))] as string[];
  const residencyMap: Record<string, string> = {};
  if (residencyIds.length > 0) {
    const { records: residencies } = await FolkResidencies.findAll({ filters: { id: { in: residencyIds } }, fields: ['id', 'residencyName'], limit: 100 });
    residencies.forEach((r: any) => { residencyMap[r.id] = (r.residencyName as string) || ''; });
  }

  const members = allMemberships.map((m: any) => {
    const gid = Array.isArray(m.group) ? m.group[0] : (m.group || (Array.isArray(m.groupId) ? m.groupId[0] : m.groupId)) as string;
    const u = refs([m.user, m.userId, m.memberId]).map(alias => userMap[alias]).find(Boolean) as any;
    if (!u) return null;

    const uRole = (u.role || '').toUpperCase();
    if (u.isBvSuperAdmin || uRole === 'SUPER ADMIN' || uRole === 'SUPER_ADMIN') return null;
    const membershipGroup = targetGroups.find(group =>
      refs([group.id, group.groupId]).some(alias => refs(gid).includes(alias)),
    );
    if (!countsAsGroupMember(u, membershipGroup?.record || membershipGroup)) return null;

    const showContacts = refs(gid).some(alias => ownGroupIds.has(alias));
    const residencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
    return {
      userId: u.userId || u.id || '',
      fullName: (u.fullName as string) || '',
      phone: showContacts ? formatPhone(u.phone) : '',
      ashrayLevel: (u.ashrayLevel as string) || null,
      email: showContacts ? ((u.email as string) || '') : '',
      groupName: groupMap[gid] || '',
      groupId: groupIdMap[gid] || '',
      isResident: !!(u.residencyApproved && residencyId),
      residencyName: residencyId ? (residencyMap[residencyId] || null) : null,
      isRgsf: !!(u.isRgsf || u.role === 'RGSF' || (Array.isArray(u.roles) && u.roles.includes('RGSF'))),
      pwChantingTarget: u.pwTargets?.chanting ?? u.pwChantingTarget ?? null,
      pwReadingTarget: u.pwTargets?.readingMin ?? u.pwReadingTarget ?? null,
      pwTargets: u.pwTargets ?? null,
    };
  }).filter(member => member !== null);

  const listed = new Set(members.flatMap(member =>
    [member.userId, member.fullName, member.email].map(value => String(value || '').trim().toLowerCase()).filter(Boolean),
  ));
  for (const group of targetGroups) {
    const staff = await loadGroupFacilitators(group.record);
    const showContacts = refs([group.id, group.groupId]).some(alias => ownGroupIds.has(alias));
    for (const entry of staff) {
      const aliases = bvUserAliases(entry.user);
      if (aliases.some(alias => listed.has(alias))) continue;
      members.push({
        userId: entry.user.userId || entry.user.id || '',
        fullName: (entry.user.fullName as string) || '',
        phone: showContacts ? formatPhone(entry.user.phone) : '',
        ashrayLevel: (entry.user.ashrayLevel as string) || null,
        email: showContacts ? ((entry.user.email as string) || '') : '',
        groupName: group.groupName || '',
        groupId: group.groupId || '',
        isResident: false,
        residencyName: null,
        isRgsf: entry.badges.includes('RGSF'),
        pwChantingTarget: entry.user.pwTargets?.chanting ?? entry.user.pwChantingTarget ?? null,
        pwReadingTarget: entry.user.pwTargets?.readingMin ?? entry.user.pwReadingTarget ?? null,
        pwTargets: entry.user.pwTargets ?? null,
      });
      aliases.forEach(alias => listed.add(alias));
    }
  }

  return { members };
}
