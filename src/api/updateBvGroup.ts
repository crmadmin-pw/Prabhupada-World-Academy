import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';
import { bvGroupFacilitatorAliases, bvUserAliases } from '@/lib/bvGroupMemberScope';
import { isHierarchyAdmin } from '@/lib/hierarchyUtils';
import { generateBvJoinToken } from '@/lib/bvJoinToken';
import { serverCacheInvalidate } from '../lib/serverCache';

function firstValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function canMintJoinToken(user: any, group: any) {
  if (isHierarchyAdmin(user)) return true;
  const aliases = new Set(bvUserAliases(user));
  return bvGroupFacilitatorAliases(group).some(alias => aliases.has(alias));
}

function canRenameReadingGroup(user: any) {
  const role = String(user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  return !!user?.isBvAdmin || !!user?.isBvSuperAdmin ||
    ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'PW_ADMIN', 'SUPER_ADMIN'].includes(role);
}

function renameStoredInvite(link: string | undefined, previousName: string, nextName: string) {
  if (!link || !previousName || previousName === nextName) return undefined;
  const encodedPrevious = encodeURIComponent(previousName);
  if (encodedPrevious && link.includes(encodedPrevious)) {
    return link.split(encodedPrevious).join(encodeURIComponent(nextName));
  }
  if (link.includes(previousName)) return link.split(previousName).join(nextName);
  return undefined;
}

async function syncAssignedGroupNames(groupKeys: Set<string>, groupName: string) {
  const users = new Map<string, any>();
  const remember = (user: any) => {
    const assignedKey = firstValue(user?.bvGroupId);
    if (!user?.id || !groupKeys.has(assignedKey) || user.bvGroupName === groupName) return;
    users.set(String(user.id), user);
  };

  const keys = [...groupKeys];
  const userFields = ['id', 'bvGroupId', 'bvGroupName'];
  const memberFields = ['id', 'group', 'groupId', 'user', 'userId', 'memberId'];
  // Look up only this group's members. A department-wide membership scan, and
  // a second realtime fan-out, kept the rename request spinning. The document
  // write already refreshes open lists.
  const [userPages, membershipPages] = await Promise.all([
    Promise.all(keys.flatMap(key => [
      Users.findAll({ filters: { bvGroupId: key }, fields: userFields, limit: 500 }),
      Users.findAll({ filters: { bvGroupId: [key] }, fields: userFields, limit: 200 }),
    ])),
    Promise.all(keys.flatMap(key => (['group', 'groupId'] as const).flatMap(field => [
      BvGroupMembers.findAll({ filters: { [field]: key }, fields: memberFields, limit: 500 }),
      BvGroupMembers.findAll({ filters: { [field]: [key] }, fields: memberFields, limit: 200 }),
    ]))),
  ]);
  userPages.forEach(page => (page.records || []).forEach(remember));

  const memberKeys = new Set<string>();
  membershipPages.forEach(page => (page.records || []).forEach((membership: any) => {
    if (!groupKeys.has(firstValue(membership.group)) && !groupKeys.has(firstValue(membership.groupId))) return;
    [membership.user, membership.userId, membership.memberId].forEach(value => {
      const key = firstValue(value);
      if (key) memberKeys.add(key);
    });
  }));

  await Promise.all([...memberKeys].map(async userKey => {
    const user = await Users.findOne({ id: userKey, fields: userFields })
      || await Users.findOne({ filters: { userId: userKey }, fields: userFields });
    if (user) remember(user);
  }));

  await Promise.all([...users.values()].map(user => Users.update({ id: user.id, record: { bvGroupName: groupName } })));
}

export default createEndpoint({
  description: 'Update a BV group name, description, WhatsApp link, or assigned Sub-Facilitator (RGSF)',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string(),
    groupName: z.string().trim().min(1).max(200).optional(),
    description: z.string().optional(),
    whatsAppLink: z.string().optional(),
    subFacilitatorId: z.string().optional(),
    isActive: z.boolean().optional(),
    ensureJoinToken: z.boolean().optional(),
    // A user id, public user id, or email assigns that RGF. An empty string
    // removes the facilitator and leaves the group's members in place.
    bvslId: z.string().max(200).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (input.groupName !== undefined && !canRenameReadingGroup(context?.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an Admin or Super Admin can rename a reading group.' });
    }

    const groupFields = ['id', 'groupId', 'groupName', 'whatsAppLink', 'joinToken', 'isActive', 'bvslLeader', 'bvslId', 'segment', 'subFacilitatorId', 'rgsfId', 'subFacilitator'];
    const group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: groupFields })
      ?? await BvGroups.findOne({ id: input.groupId, fields: groupFields });
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    const updates: any = {};
    const previousName = String(group.groupName || '');
    const nextName = input.groupName === undefined ? undefined : String(input.groupName).trim();
    if (input.groupName !== undefined && !nextName) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Please enter a group name' });
    }
    const nameChanged = nextName !== undefined && nextName !== previousName;
    if (nameChanged) updates.groupName = nextName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.whatsAppLink !== undefined) updates.whatsAppLink = input.whatsAppLink;
    else if (nameChanged) {
      const nextLink = renameStoredInvite(group.whatsAppLink, previousName, nextName);
      if (nextLink) updates.whatsAppLink = nextLink;
    }
    if (input.isActive !== undefined) updates.isActive = input.isActive;
    if (input.bvslId !== undefined) {
      if (!canRenameReadingGroup(context?.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Only an Admin can change who facilitates a reading group.' });
      }
      const nextFacilitatorId = String(input.bvslId || '').trim();
      if (!nextFacilitatorId) {
        updates.bvslLeader = '';
        updates.bvslId = '';
        updates.bvslName = '';
      } else {
        const facilitatorFields = ['id', 'userId', 'fullName', 'email', 'role', 'isBvFacilitator', 'isBvsl'];
        const facilitator = await Users.findOne({ id: nextFacilitatorId, fields: facilitatorFields })
          || await Users.findOne({ filters: { userId: nextFacilitatorId }, fields: facilitatorFields })
          || await Users.findOne({ filters: { email: nextFacilitatorId.toLowerCase() }, fields: facilitatorFields });
        if (!facilitator) throw new AppError({ code: 'NOT_FOUND', message: 'Selected RGF was not found' });
        const facilitatorRole = String(facilitator.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
        const isRgf = facilitator.isBvFacilitator === true || facilitator.isBvsl === true || ['RGF', 'BVSL', 'FACILITATOR'].includes(facilitatorRole);
        if (!isRgf) throw new AppError({ code: 'BAD_REQUEST', message: 'Choose someone who is already an RGF' });
        updates.bvslLeader = facilitator.id;
        updates.bvslId = facilitator.userId || facilitator.id;
        updates.bvslName = facilitator.fullName || facilitator.email || '';
      }
    }
    if (input.subFacilitatorId !== undefined) {
      updates.subFacilitatorId = input.subFacilitatorId;
      updates.rgsfId = input.subFacilitatorId;

      if (input.subFacilitatorId) {
        const u = await Users.findOne({ filters: { userId: input.subFacilitatorId }, fields: ['id'] })
          ?? await Users.findOne({ id: input.subFacilitatorId, fields: ['id'] });
        if (u) {
          await Users.update({ id: u.id, record: { isBvSubFacilitator: true } });
        }
      }
    }

    let joinToken: string | null = null;
    if (input.ensureJoinToken) {
      if (group.isActive === false) {
        throw new AppError({ code: 'BAD_REQUEST', message: 'This group is no longer active' });
      }
      if (!canMintJoinToken(context?.user, group)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Only this group\'s RGF or an admin can create an invite link' });
      }
      joinToken = String(group.joinToken || '').trim() || generateBvJoinToken();
      if (joinToken !== group.joinToken) updates.joinToken = joinToken;
    }

    if (Object.keys(updates).length > 0) {
      await BvGroups.update({ id: group.id, record: updates });
    }
    if (input.bvslId !== undefined) {
      serverCacheInvalidate('allBvGroupsAdmin:');
      serverCacheInvalidate('bvslMembers:');
    }
    if (nameChanged) {
      const groupKeys = new Set([group.id, group.groupId].filter(Boolean).map(value => String(value)));
      await syncAssignedGroupNames(groupKeys, nextName);
      serverCacheInvalidate('allBvGroupsAdmin:');
      serverCacheInvalidate('bvslMembers:');
      serverCacheInvalidate('getBvGroupDetail:');
    }

    return {
      success: true,
      groupName: nameChanged ? nextName : previousName,
      ...(input.ensureJoinToken ? { joinToken } : {}),
    };
  },
});
