import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroups, Users, AppError } from '@/lib/backend-sdk';

function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

async function resolveUserFromKeys(keys: string[]) {
  for (const key of [...new Set(keys.filter(Boolean))]) {
    const user = await Users.findOne({ id: key, fields: ['id', 'userId'] })
      || await Users.findOne({ filters: { userId: key }, fields: ['id', 'userId'] });
    if (user) return user;
  }
  return null;
}

export default createEndpoint({
  description: 'Remove a member from a BV group',
  authenticated: true,
  inputSchema: z.object({
    membershipId: z.string().optional(),
    groupId: z.string().optional(),
    userId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }: any) => {

    let membershipDbId = input.membershipId;
    let groupDbId = '';

    if (!membershipDbId && input.groupId && input.userId) {
      // Find user by custom userId field
      const user = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });

      // Find group — first try by DB record ID (UUID), then by custom groupId field
      let group = await BvGroups.findOne({ id: input.groupId, fields: ['id'] });
      if (!group) {
        group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id'] });
      }

      if (group && user) {
        groupDbId = group.id;
        const membership = await BvGroupMembers.findOne({ filters: { group: group.id, user: user.id } });
        if (membership) membershipDbId = membership.id;
      }
    }

    if (!membershipDbId) throw new AppError({ code: 'NOT_FOUND', message: 'Membership not found' });

    const membership = await BvGroupMembers.findOne({ id: membershipDbId });
    groupDbId = groupDbId || firstValue(membership?.group || (membership as any)?.groupId);
    const initialKeys = [firstValue(membership?.user), firstValue((membership as any)?.userId), input.userId].filter(Boolean);
    const resolvedUser = await resolveUserFromKeys(initialKeys);
    const userKeys = new Set([
      ...initialKeys,
      resolvedUser?.id,
      resolvedUser?.userId,
    ].filter(Boolean).map(String));

    if (groupDbId) {
      const { records: groupMemberships } = await BvGroupMembers.findAll({
        filters: { group: groupDbId },
        fields: ['id', 'user', 'userId'],
        limit: 1000,
      });
      const deleteIds = groupMemberships
        .filter((m: any) =>
          m.id === membershipDbId ||
          userKeys.has(firstValue(m.user)) ||
          userKeys.has(firstValue(m.userId))
        )
        .map((m: any) => m.id);
      await Promise.all([...new Set(deleteIds)].map(id => BvGroupMembers.delete({ id })));
    } else {
      await BvGroupMembers.delete({ id: membershipDbId });
    }

    const profileIds = [...new Set([resolvedUser?.id, firstValue(membership?.user)].filter(Boolean).map(String))];
    await Promise.all(profileIds.map(id =>
      Users.update({
        id,
        record: {
          bvGroupId: '',
          bvGroupName: '',
          bvRegistrationStatus: '',
          isBvMember: false,
        }
      }).catch(() => {})
    ));

    return { success: true, message: 'Member removed from group' };

  },
});
