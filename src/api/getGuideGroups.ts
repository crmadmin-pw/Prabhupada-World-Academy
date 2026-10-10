import { z } from 'zod';
import { createEndpoint } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { resolveBvScopedGroups, resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';

export default createEndpoint({
  description: 'Get authorized FOLK BV groups and members for a guide',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const [hierarchy, groups, candidates] = await Promise.all([
      getScopedHierarchyUserIds(context.user),
      resolveBvScopedGroups(context.user, { segment: 'FOLK' }),
      readScopedUsers(context.user, { filters: { status: 'Active' }, fields: ['id', 'userId', 'email', 'fullName', 'status', 'segment', 'isPrabhupadaWorldUser'], limit: 2000 }),
    ]);
    const activeUsers = candidates.records.filter(user => isUserInHierarchy(user, hierarchy) &&
      !user.isPrabhupadaWorldUser && !['PW', 'PRABHUPADA WORLD'].includes(String(user.segment || '').toUpperCase()));
    const groupsWithDetails = await Promise.all(groups.map(async group => {
      const members = await resolveBvGroupMemberUsers(context.user, ['id', 'userId', 'fullName'], { groupId: group.id, segment: 'FOLK' });
      return {
        groupId: group.groupId,
        groupName: group.groupName,
        description: String(group.record.description || ''),
        memberCount: members.length,
        avgScore7d: 0,
        submissionRate7d: 0,
        members: members.map(user => ({ userId: String(user.userId || user.id), fullName: String(user.fullName || '') })),
      };
    }));
    return {
      groups: groupsWithDetails,
      availableUsers: activeUsers.map(user => ({ userId: user.userId || user.id, fullName: user.fullName || '', status: user.status || 'Active' })),
    };
  },
});
