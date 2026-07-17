import { z } from 'zod';
import { createEndpoint, PushSubscriptions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Unsubscribe from Web Push notifications',
  authenticated: true,
  inputSchema: z.object({ endpoint: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const userId = context.user.id;
    const existing = await PushSubscriptions.findOne({
      filters: { endpoint: input.endpoint, user: userId },
    });
    if (existing) {
      await PushSubscriptions.delete({ id: existing.id });
    }
    return { success: true };
  },
});
