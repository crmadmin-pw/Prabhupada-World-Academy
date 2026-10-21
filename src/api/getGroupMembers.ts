import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';
import { loadGroupFacilitators } from '@/lib/bvGroupFacilitators';
import { bvUserAliases } from '@/lib/bvGroupMemberScope';

const formatPhone = (phone?: string) => {
  if (!phone) return '';
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length > 10 && !phone.startsWith('+')) {
    return `+${phone}`;
  }
  return phone;
};

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

export default createEndpoint({
  description: 'Get members of a specific BV group with user details',
  authenticated: true,
  // Same gate as getBvGroupDetail / getBvslMembers, which expose the same member data.
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({ groupDbId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }: any) => {
    // Try by DB UUID first, then by custom groupId field
    const groupFields = ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator'];
    let group = await BvGroups.findOne({ id: input.groupDbId, fields: groupFields });
    if (!group) group = await BvGroups.findOne({ filters: { groupId: input.groupDbId }, fields: groupFields });
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user', 'userId', 'role', 'joinedAt'],
      limit: 500,
    });

    const memberUserIds = memberships
      .flatMap(m => [firstValue(m.user), firstValue((m as any).userId)])
      .filter(Boolean);

    const userMap: Record<string, any> = {};
    if (memberUserIds.length > 0) {
      // 1. Find by database id/UUID
      const { records: usersById } = await Users.findAll({
        filters: { id: { in: memberUserIds } as any },
        fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'currentStreak', 'email', 'status', 'isBvMember', 'bvGroupId'],
        limit: 500,
      });
      for (const u of usersById) {
        userMap[u.id] = u;
        if (u.userId) userMap[u.userId] = u;
        if (u.fullName) userMap[u.fullName] = u;
        if (u.fullName) userMap[u.fullName.toLowerCase()] = u;
        if (u.email) userMap[u.email.toLowerCase()] = u;
      }

      // 2. Find by custom userId string
      const { records: usersByCustomId } = await Users.findAll({
        filters: { userId: { in: memberUserIds } as any },
        fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'currentStreak', 'email', 'status', 'isBvMember', 'bvGroupId'],
        limit: 500,
      });
      for (const u of usersByCustomId) {
        userMap[u.id] = u;
        if (u.userId) userMap[u.userId] = u;
        if (u.fullName) userMap[u.fullName] = u;
        if (u.fullName) userMap[u.fullName.toLowerCase()] = u;
        if (u.email) userMap[u.email.toLowerCase()] = u;
      }

      // 3. Find by fullName (highly common in backup CSV files)
      const { records: usersByName } = await Users.findAll({
        filters: { fullName: { in: memberUserIds } as any },
        fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'currentStreak', 'email', 'status', 'isBvMember', 'bvGroupId'],
        limit: 500,
      });
      for (const u of usersByName) {
        userMap[u.id] = u;
        if (u.userId) userMap[u.userId] = u;
        if (u.fullName) userMap[u.fullName] = u;
        if (u.fullName) userMap[u.fullName.toLowerCase()] = u;
        if (u.email) userMap[u.email.toLowerCase()] = u;
      }
    }

    const groupAliases = new Set([group.id, group.groupId].filter(Boolean).map(value => String(value).toLowerCase()));
    const activeMemberships = memberships.filter(m => {
      const uid = firstValue(m.user);
      const altUid = firstValue((m as any).userId);
      const u = userMap[uid] || userMap[uid.toLowerCase()] || userMap[altUid] || userMap[altUid.toLowerCase()];
      const profileGroupId = firstValue(u?.bvGroupId).toLowerCase();
      const isCurrentGroup = profileGroupId ? groupAliases.has(profileGroupId) : !!u?.isBvMember;
      const isActiveUser = !u?.status || String(u.status).toLowerCase() === 'active';
      return !!u && !!u.isBvMember && isCurrentGroup && isActiveUser;
    });

    const members = activeMemberships.map(m => {
        const uid = firstValue(m.user);
        const altUid = firstValue((m as any).userId);
        const u = userMap[uid] || userMap[String(uid).toLowerCase()] || userMap[altUid] || userMap[String(altUid).toLowerCase()] || {};
        return {
          membershipId: m.id,
          userId: u.userId || u.id || uid,
          fullName: u.fullName || '',
          phone: formatPhone(u.phone),
          ashrayLevel: u.ashrayLevel || null,
          currentStreak: u.currentStreak ?? 0,
          role: m.role || 'Member',
          joinedAt: m.joinedAt || null,
        };
      });
    const listed = new Set(members.flatMap(member => [member.userId, member.fullName].map(value => String(value || '').trim().toLowerCase()).filter(Boolean)));
    const staff = await loadGroupFacilitators(group);
    for (const entry of staff) {
      const aliases = bvUserAliases(entry.user);
      if (aliases.some(alias => listed.has(alias))) continue;
      members.push({
        membershipId: '',
        userId: entry.user.userId || entry.user.id,
        fullName: entry.user.fullName || '',
        phone: formatPhone(entry.user.phone),
        ashrayLevel: entry.user.ashrayLevel || null,
        currentStreak: entry.user.currentStreak ?? 0,
        role: entry.badges.includes('RGF') ? 'RGF' : 'RGSF',
        joinedAt: null,
      });
      aliases.forEach(alias => listed.add(alias));
    }

    return {
      groupId: group.groupId || group.id,
      groupDbId: group.id,
      groupName: group.groupName || '',
      members,
    };
  },
});
