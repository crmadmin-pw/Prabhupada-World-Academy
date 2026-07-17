import { z } from 'zod';
import { createEndpoint, PushSubscriptions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Subscribe to Web Push notifications',
  authenticated: true,
  inputSchema: z.object({
    endpoint: z.string(),
    p256dh: z.string(),
    auth: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    action: z.enum(['created', 'updated']),
  }),
  execute: async ({ input, context }) => {
    const userId = context.user.id;

    // Check if this exact endpoint already exists for this user
    const existing = await PushSubscriptions.findOne({
      filters: { endpoint: input.endpoint, user: userId },
    });

    if (existing) {
      // Update keys on existing record
      await PushSubscriptions.update({
        id: existing.id,
        record: { p256DhKey: input.p256dh, authKey: input.auth },
      });
      return { success: true, action: 'updated' as const };
    }

    // New endpoint — delete ALL existing subscriptions for this user first (one-sub-per-user policy)
    const allExisting = await PushSubscriptions.findAll({
      filters: { user: userId },
      limit: 100,
    });
    for (const sub of allExisting.records) {
      await PushSubscriptions.delete({ id: sub.id });
    }

    // Create new subscription
    await PushSubscriptions.create({
      record: {
        endpoint: input.endpoint,
        user: userId,
        p256DhKey: input.p256dh,
        authKey: input.auth,
      },
    });

    return { success: true, action: 'created' as const };
  },
});
