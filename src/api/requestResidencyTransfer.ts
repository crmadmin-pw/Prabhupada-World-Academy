import { z } from 'zod';
import { createEndpoint, ResidencyTransferRequests, FolkResidencies, ZiteError, Users } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Submit a residency transfer request',
  authenticated: true,
  inputSchema: z.object({
    toResidencyId: z.string().max(100).optional(),
    newResidencyId: z.string().max(100).optional(),
    reason: z.string().max(1000).optional(),
    email: z.string().email().max(320).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const targetResidencyId = input.toResidencyId || input.newResidencyId;
    if (!targetResidencyId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'toResidencyId is required' });

    const existing = await ResidencyTransferRequests.findOne({ filters: { user: context.user.id, status: 'Pending' } });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'You already have a pending residency transfer request' });

    // Find residency by residencyId field
    const residencyRecord = await FolkResidencies.findOne({ filters: { residencyId: targetResidencyId }, fields: ['id'] });
    const toResidencyDbId = residencyRecord?.id || targetResidencyId;

    const userProfile = await Users.findOne({ id: context.user.id, fields: ['residency', 'residencyApproved'] });
    const fromResidencyId = userProfile?.residencyApproved
      ? (Array.isArray(userProfile.residency) ? userProfile.residency[0] : userProfile.residency)
      : undefined;

    const record = await ResidencyTransferRequests.create({
      record: {
        user: context.user.id,
        fromResidency: fromResidencyId || undefined,
        toResidency: toResidencyDbId,
        notes: input.reason || '',
        status: 'Pending',
        requestedAt: new Date().toISOString(),
      },
    });

    serverCacheInvalidate(`user_profile:${context.user.id}`);

    return { success: true, requestId: record.id };
  },
});
