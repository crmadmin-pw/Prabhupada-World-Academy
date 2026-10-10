import { z } from 'zod';
import { createEndpoint } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';

export default createEndpoint({
  description: 'Get all active Sadhana Mentors',
  authenticated: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK', 'ALL']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const scope = await getScopedHierarchyUserIds(context.user);
    const { records } = await readScopedUsers(context.user, {
      filters: { status: 'Active' },
      fields: ['id', 'userId', 'fullName', 'email', 'isSadhanaMentor', 'role', 'segment', 'isPrabhupadaWorldUser'],
      limit: 1000,
    });

    const mentors = records.filter(user => isUserInHierarchy(user, scope))
      .filter((u: any) => 
        (u.isSadhanaMentor === true || (u.role || '').toUpperCase() === 'SADHANA_MENTOR' || (u.role || '').toUpperCase() === 'SADHANA MENTOR') &&
        (u.segment === 'PW' || !!u.isPrabhupadaWorldUser)
      )
      .map((u: any) => ({
        userId: u.id || u.userId,
        fullName: u.fullName || '',
        email: u.email || '',
        segment: u.segment === 'PW' || u.isPrabhupadaWorldUser ? 'PW' : (u.segment || ''),
      }));

    if (input.segment && input.segment !== 'ALL') {
      return mentors.filter((m: any) => m.segment === input.segment);
    }
    return mentors;
  },
});
