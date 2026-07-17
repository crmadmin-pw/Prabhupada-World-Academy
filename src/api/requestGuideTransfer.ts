import { z } from 'zod';
import { createEndpoint, GuideTransferRequests, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Submit a guide transfer request',
  authenticated: true,
  inputSchema: z.object({
    toGuideId: z.string().optional(),
    newGuideId: z.string().optional(),
    reason: z.string().optional(),
    email: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const targetGuideId = input.toGuideId || input.newGuideId;
    if (!targetGuideId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'toGuideId is required' });

    const existing = await GuideTransferRequests.findOne({ filters: { user: context.user.id, status: 'Pending' } });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'You already have a pending guide transfer request' });

    // Find the guide DB record by guideId field
    const guideRecord = await Guides.findOne({ filters: { guideId: targetGuideId }, fields: ['id'] });
    const toGuideDbId = guideRecord?.id || targetGuideId;

    const userProfile = await Users.findOne({ id: context.user.id, fields: ['guide'] });
    const fromGuideId = Array.isArray(userProfile?.guide) ? userProfile.guide[0] : userProfile?.guide;

    const record = await GuideTransferRequests.create({
      record: {
        user: context.user.id,
        fromGuide: fromGuideId || undefined,
        toGuide: toGuideDbId,
        notes: input.reason || '',
        status: 'Pending',
        requestedAt: new Date().toISOString(),
      },
    });

    serverCacheInvalidate(`user_profile:${context.user.id}`);

    return { success: true, requestId: record.id };
  },
});
