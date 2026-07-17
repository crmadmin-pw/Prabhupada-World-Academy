import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Appoint or remove a cleanliness manager',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    isManager: z.boolean(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const role = context.user?.role;
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }
    await Users.update({
      id: input.userId,
      record: { isCleanlinessManager: input.isManager } as any,
    });
    serverCacheInvalidate('user_profile:' + input.userId);
    return { success: true };
  },
});
