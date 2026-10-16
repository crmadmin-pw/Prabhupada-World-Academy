import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Guides, Users, AppError } from '@/lib/backend-sdk';
import { bvGroupFacilitatorAliases, bvUserAliases } from '@/lib/bvGroupMemberScope';
import {
  facilitatorIdentityKeys,
  facilitatorWrite,
  readGroupFacilitators,
  type GroupFacilitator,
} from '@/lib/bvGroupFacilitators';
import { isHierarchyAdmin } from '@/lib/hierarchyUtils';
import { generateBvJoinToken } from '@/lib/bvJoinToken';
import { assertUniqueBvGroupName, bvGroupDepartment } from '@/lib/bvGroupName';
import { serverCacheInvalidate } from '../lib/serverCache';

function firstValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function rawFacilitatorRefs(group: any): string[] {
  return [group?.bvslLeader, group?.bvslId, group?.subFacilitatorId, group?.rgsfId, group?.subFacilitator]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
}

function sharesAlias(left: Iterable<string>, right: Set<string>): boolean {
  for (const alias of left) {
    if (right.has(alias)) return true;
  }
  return false;
}

/** Older groups stored the RGF as a display name or a Guides id. The groups
 * list already treats those as this person's groups, so invite minting does too. */
async function linkedFacilitatorAliases(rawId: string): Promise<string[]> {
  const person = await findFacilitatorRecord(rawId);
  if (person) return bvUserAliases(person);

  const guideFields = ['id', 'guideId', 'email', 'fullName'];
  const guide = await Guides.findOne({ id: rawId, fields: guideFields })
    || await Guides.findOne({ filters: { guideId: rawId }, fields: guideFields });
  if (!guide) return [];

  const aliases = [guide.id, guide.guideId, guide.email, guide.fullName]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (guide.email) {
    const linked = await findFacilitatorRecord(String(guide.email));
    if (linked) aliases.push(...bvUserAliases(linked));
  }
  return aliases;
}

async function canMintJoinToken(user: any, group: any): Promise<boolean> {
  if (isHierarchyAdmin(user)) return true;
  const aliases = new Set(bvUserAliases(user));
  const stored = [
    ...bvGroupFacilitatorAliases(group),
    ...readGroupFacilitators(group).flatMap(item => facilitatorIdentityKeys(item)),
  ];
  if (sharesAlias(stored, aliases)) return true;

  for (const ref of rawFacilitatorRefs(group)) {
    if (sharesAlias(await linkedFacilitatorAliases(ref), aliases)) return true;
  }
  return false;
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

async function findFacilitatorRecord(rawId: string) {
  const facilitatorFields = ['id', 'userId', 'fullName', 'email', 'role', 'isBvFacilitator', 'isBvsl'];
  return await Users.findOne({ id: rawId, fields: facilitatorFields })
    || await Users.findOne({ filters: { userId: rawId }, fields: facilitatorFields })
    || await Users.findOne({ filters: { email: rawId.toLowerCase() }, fields: facilitatorFields });
}

async function resolveReadingGroupFacilitator(rawId: string) {
  const facilitator = await findFacilitatorRecord(rawId);
  if (!facilitator) throw new AppError({ code: 'NOT_FOUND', message: 'Selected RGF was not found' });
  const facilitatorRole = String(facilitator.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  const isRgf = facilitator.isBvFacilitator === true || facilitator.isBvsl === true || ['RGF', 'BVSL', 'FACILITATOR'].includes(facilitatorRole);
  if (!isRgf) throw new AppError({ code: 'BAD_REQUEST', message: 'Choose someone who is already an RGF' });
  return {
    id: String(facilitator.id || ''),
    userId: String(facilitator.userId || facilitator.id || ''),
    name: String(facilitator.fullName || facilitator.email || ''),
    email: String(facilitator.email || ''),
  };
}

/** Taking an RGF off a group also takes them off its member list. */
async function removeFacilitatorMembership(group: any, aliases: Set<string>, person: any) {
  const groupRefs = [...new Set([group.id, group.groupId].filter(Boolean).map(String))];
  const groupFilter = groupRefs.length > 1 ? { in: groupRefs } : group.id;
  const fields = ['id', 'user', 'userId', 'memberId', 'group', 'groupId'];
  const [byGroup, byGroupId] = await Promise.all([
    BvGroupMembers.findAll({ filters: { group: groupFilter } as any, fields, limit: 500 }),
    BvGroupMembers.findAll({ filters: { groupId: groupFilter } as any, fields, limit: 500 }),
  ]);
  const rows = [...new Map([...byGroup.records, ...byGroupId.records].map(row => [String(row.id), row])).values()];
  const keyOf = (value: unknown) => firstValue(value).trim().toLowerCase();
  const removed = rows.filter(row => [row.user, row.userId, row.memberId].some(value => aliases.has(keyOf(value))));
  await Promise.all(removed.map(row => BvGroupMembers.delete({ id: row.id })));

  const profileIds = [...new Set([person?.id, ...removed.map(row => firstValue(row.user))].filter(Boolean).map(String))];
  const groupKeys = new Set(groupRefs);
  await Promise.all(profileIds.map(async id => {
    const user = await Users.findOne({ id, fields: ['id', 'bvGroupId'] })
      || await Users.findOne({ filters: { userId: id }, fields: ['id', 'bvGroupId'] });
    if (!user?.id) return;
    const assigned = firstValue(user.bvGroupId);
    if (assigned && !groupKeys.has(assigned)) return;
    await Users.update({
      id: user.id,
      record: { bvGroupId: '', bvGroupName: '', isBvMember: false },
    });
  }));
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
    // A user id, public user id, or email. `add` keeps the RGFs already on the
    // group. `remove` takes only this RGF off the group. An empty string
    // clears every RGF and leaves the group's members in place.
    bvslId: z.string().max(200).optional(),
    facilitatorAction: z.enum(['add', 'remove']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (input.groupName !== undefined && !canRenameReadingGroup(context?.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an Admin or Super Admin can rename a reading group.' });
    }

    const groupFields = ['id', 'groupId', 'groupName', 'whatsAppLink', 'joinToken', 'isActive', 'bvslLeader', 'bvslId', 'bvslName', 'segment', 'subFacilitatorId', 'rgsfId', 'subFacilitator'];
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
    if (nameChanged) {
      await assertUniqueBvGroupName(nextName, bvGroupDepartment(group.segment), [group.id, group.groupId]);
      updates.groupName = nextName;
    }
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
      const action = input.facilitatorAction || (nextFacilitatorId ? 'add' : 'remove');
      if (!nextFacilitatorId) {
        Object.assign(updates, facilitatorWrite([]));
      } else if (action === 'remove') {
        // A person who was just changed from RGF to RGSF is no longer an RGF,
        // but their id can still be stored on the group. Removal has to match
        // that stored id without requiring the old role.
        const person = await findFacilitatorRecord(nextFacilitatorId);
        const aliases = new Set(
          [nextFacilitatorId, person?.id, person?.userId, person?.email, person?.fullName]
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean),
        );
        const next = readGroupFacilitators(group).filter(item =>
          !facilitatorIdentityKeys(item).some(key => aliases.has(key)),
        );
        Object.assign(updates, facilitatorWrite(next));
        await removeFacilitatorMembership(group, aliases, person);
      } else {
        const facilitator = await resolveReadingGroupFacilitator(nextFacilitatorId);
        const current = readGroupFacilitators(group);
        const incoming = new Set(facilitatorIdentityKeys(facilitator));
        const alreadyThere = (item: GroupFacilitator) =>
          facilitatorIdentityKeys(item).some(key => incoming.has(key));
        const next = current.some(alreadyThere) ? current : [...current, {
          id: facilitator.id,
          userId: facilitator.userId,
          name: facilitator.name,
        }];
        Object.assign(updates, facilitatorWrite(next));
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
      if (!(await canMintJoinToken(context?.user, group))) {
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
