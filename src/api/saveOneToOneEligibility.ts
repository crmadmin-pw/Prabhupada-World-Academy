import { z } from 'zod';
import { AppError, createEndpoint, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, HIERARCHY_IDENTITY_FIELDS, isUserInHierarchy } from '@/lib/hierarchyUtils';

export default createEndpoint({
  description: 'Save the 1:1 eligibility and delegate for a user (guide only)',
  authenticated: true,
  // Guides, mentors and BV leaders manage the members assigned to them; the
  // member list this sheet edits comes from the same hierarchy.
  requiredCapabilities: 'users.assigned.read',
  inputSchema: z.object({
    userId: z.string(),
    eligibility: z.enum(['Guide', 'Delegated', 'Not Eligible']),
    delegateId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const target = await Users.findOne({ id: input.userId, fields: [...HIERARCHY_IDENTITY_FIELDS] });
    if (!target) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });
    if (!isUserInHierarchy(target, await getScopedHierarchyUserIds(context.user))) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This user is not assigned to your hierarchy' });
    }
    const record: any = {
      oneToOneEligibility: input.eligibility,
      oneToOneDelegate: input.eligibility === 'Delegated' && input.delegateId ? [input.delegateId] : [],
    };
    await Users.update({ id: input.userId, record });
    return { success: true };
  },
});
