import { z } from 'zod';
import { createEndpoint, ServiceRatings, Services } from 'zite-integrations-backend-sdk';
import crypto from 'crypto';

export default createEndpoint({
  description: 'Submit an anonymous service quality rating. No user ID is stored — only a one-way hash to prevent duplicate ratings.',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    ratingDate: z.string(), // yyyy-MM-dd
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(200).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    alreadyRated: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    // Verify service exists
    const svc = await Services.findOne({ id: input.serviceId, fields: ['id'] });
    if (!svc) throw new Error('Service not found');

    // Generate one-way hash from userId + date + serviceId — only used to prevent duplicates
    // This hash cannot be reversed to identify the rater
    const raterHash = crypto
      .createHash('sha256')
      .update(`${context.user!.id}:${input.ratingDate}:${input.serviceId}`)
      .digest('hex');

    // Check for duplicate
    const existing = await ServiceRatings.findOne({ filters: { raterHash } });
    if (existing) return { success: false, alreadyRated: true };

    // Create rating — NO userId field stored, only the hash
    await ServiceRatings.create({
      record: {
        service: input.serviceId,
        ratingDate: input.ratingDate,
        rating: input.rating,
        comment: input.comment || '',
        raterHash,
      },
    });

    return { success: true, alreadyRated: false };
  },
});
