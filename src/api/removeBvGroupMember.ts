import { z } from 'zod';
import { createEndpoint, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

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
  description: 'Remove a member from a BV group by membership record ID',
  authenticated: true,
  inputSchema: z.object({ membershipId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {

    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only guides or BV Mentors can remove members' });
    }
    const membership = await BvGroupMembers.findOne({ id: input.membershipId });
    const groupDbId = firstValue(membership?.group || (membership as any)?.groupId);
    const initialKeys = [firstValue(membership?.user), firstValue((membership as any)?.userId)].filter(Boolean);
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
          m.id === input.membershipId ||
          userKeys.has(firstValue(m.user)) ||
          userKeys.has(firstValue(m.userId))
        )
        .map((m: any) => m.id);
      await Promise.all([...new Set(deleteIds)].map(id => BvGroupMembers.delete({ id })));
    } else {
      await BvGroupMembers.delete({ id: input.membershipId });
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
    // Bust member-list and group-list caches — membership changed.
    serverCacheInvalidate('bvslMembers:');
    serverCacheInvalidate('allBvGroupsAdmin:');
    return { success: true };
  },
});
