import { z } from 'zod';
import { createEndpoint, GuideTransferRequests, Users, Guides, AppError } from '@/lib/backend-sdk';
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
    if (!targetGuideId) throw new AppError({ code: 'BAD_REQUEST', message: 'toGuideId is required' });

    const existing = await GuideTransferRequests.findOne({ filters: { user: context.user.id, status: 'Pending' } });
    if (existing) throw new AppError({ code: 'CONFLICT', message: 'You already have a pending guide transfer request' });

    // Find the guide DB record by guideId field
    const guideRecord = await Guides.findOne({ filters: { guideId: targetGuideId }, fields: ['id'] })
      || await Guides.findOne({ id: targetGuideId, fields: ['id'] })
      || await Guides.findOne({ filters: { email: targetGuideId.toLowerCase() }, fields: ['id'] });
    const toGuideDbId = guideRecord?.id || targetGuideId;

    const userProfile = await Users.findOne({ id: context.user.id, fields: ['guide'] });
    const fromGuideId = Array.isArray(userProfile?.guide) ? userProfile.guide[0] : userProfile?.guide;
    // Store a canonical Guides-table id when possible. Legacy user records may
    // hold the source guide as a custom userId, email, or display name.
    const sourceGuide = fromGuideId ? (
      await Guides.findOne({ id: fromGuideId, fields: ['id'] }) ||
      await Guides.findOne({ filters: { guideId: fromGuideId }, fields: ['id'] }) ||
      await Guides.findOne({ filters: { email: String(fromGuideId).toLowerCase() }, fields: ['id'] })
    ) : undefined;

    const record = await GuideTransferRequests.create({
      record: {
        user: context.user.id,
        fromGuide: sourceGuide?.id || fromGuideId || undefined,
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
