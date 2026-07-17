import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save the 1:1 eligibility and delegate for a user (guide only)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    eligibility: z.enum(['Guide', 'Delegated', 'Not Eligible']),
    delegateId: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const record: any = {
      oneToOneEligibility: input.eligibility,
      oneToOneDelegate: input.eligibility === 'Delegated' && input.delegateId ? [input.delegateId] : [],
    };
    await Users.update({ id: input.userId, record });
    return { success: true };
  },
});
