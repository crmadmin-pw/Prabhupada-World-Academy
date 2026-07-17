import { z } from 'zod';
import { createEndpoint, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Remove a member from a BV group by membership record ID',
  authenticated: true,
  inputSchema: z.object({ membershipId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!['Guide', 'Super Guide'].includes(callerRole) && !isBvMentor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or BV Mentors can remove members' });
    }
    await BvGroupMembers.delete({ id: input.membershipId });
    return { success: true };
  },
});
