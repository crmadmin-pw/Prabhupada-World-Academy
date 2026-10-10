import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

function firstValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export default createEndpoint({
  description: 'Permanently delete a BV group and unassign all of its members',
  authenticated: true,
  inputSchema: z.object({ groupId: z.string() }),
  outputSchema: z.object({ success: z.boolean(), membersUnassigned: z.number() }),
  execute: async ({ input, context }: any) => {
    const role = String(context.user?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
    const canDelete = ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'PW_ADMIN', 'SUPER_ADMIN'].includes(role) ||
      !!context.user?.isBvAdmin || !!context.user?.isBvSuperAdmin;
    if (!canDelete) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an Admin, Super Admin, Guide, or Super Guide can delete a group.' });
    }

    const group = await BvGroups.findOne({ id: input.groupId, fields: ['id', 'groupId'] }) ||
      await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id', 'groupId'] });
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found.' });

    const groupKeys = new Set([group.id, group.groupId].filter(Boolean).map(String));
    const { records: allMemberships } = await BvGroupMembers.findAll({
      fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
      limit: 5000,
    });
    const memberships = allMemberships.filter((membership: any) =>
      groupKeys.has(firstValue(membership.group)) || groupKeys.has(firstValue(membership.groupId))
    );

    const userKeys = new Set<string>();
    memberships.forEach((membership: any) => {
      [membership.user, membership.userId, membership.memberId].forEach(value => {
        const key = firstValue(value);
        if (key) userKeys.add(key);
      });
    });

    let membersUnassigned = 0;
    for (const userKey of userKeys) {
      const user = await Users.findOne({ id: userKey, fields: ['id', 'userId'] }) ||
        await Users.findOne({ filters: { userId: userKey }, fields: ['id', 'userId'] });
      if (!user) continue;
      await Users.update({
        id: user.id,
        // They remain approved BV members and can be assigned to another group,
        // but have no current group after this group is deleted.
        record: { bvGroupId: '', bvGroupName: '', bvRegistrationStatus: 'Approved', isBvMember: true },
      });
      membersUnassigned++;
    }

    await Promise.all(memberships.map((membership: any) => BvGroupMembers.delete({ id: membership.id })));
    await BvGroups.delete({ id: group.id });

    serverCacheInvalidate('bvslMembers:');
    serverCacheInvalidate('allBvGroupsAdmin:');
    serverCacheInvalidate('getBvGroupDetail:');
    return { success: true, membersUnassigned };
  },
});
