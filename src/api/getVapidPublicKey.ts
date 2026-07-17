import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Returns the VAPID public key for Web Push subscription',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({ publicKey: z.string() }),
  execute: async () => {
    return { publicKey: process.env.ZITE_VAPID_PUBLIC_KEY };
  },
});
