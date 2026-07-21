import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Acknowledge Bhakti Vriksha role change notice on login',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    await Users.update({
      id: context.user.id,
      record: {
        roleNoticeAcknowledged: true,
      },
    }).catch(() => {});

    serverCacheInvalidate(profileCacheKey(context.user.id));
    return { success: true };
  },
});
