import { z } from 'zod';
import { createEndpoint, Users, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Set or update the FOLK center (residency) for the authenticated user without a residency claim',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string().min(1),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    const residencyRecord = await FolkResidencies.findOne({ id: input.residencyId });
    if (!residencyRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'Residency not found' });

    await Users.update({
      id: context.user!.id,
      record: { residency: residencyRecord.id },
    });

    serverCacheInvalidate(`user_profile:${context.user!.id}`);

    return { success: true };
  },
});
