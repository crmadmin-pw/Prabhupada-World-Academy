import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Permanently delete user account so they can re-register with the same email',
  authenticated: true,
  inputSchema: z.object({
    confirm: z.boolean().optional(),
    confirmText: z.string().optional(),
    email: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!input.confirm && input.confirmText !== 'DELETE') return { success: false };

    // Hard delete — removes the record entirely so they can re-register
    await Users.delete({ id: context.user!.id });
    return { success: true };
  },
});
