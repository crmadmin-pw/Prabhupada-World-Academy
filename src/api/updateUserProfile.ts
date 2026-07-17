import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Update user profile fields — writes all provided fields to the Users table',
  authenticated: true,
  inputSchema: z.object({
    fullName: z.string().max(200).optional(),
    phone: z.string().max(25).optional(),
    ashrayLevel: z.string().max(50).optional(),
    guideId: z.string().max(100).optional(),
    residencyId: z.string().max(100).optional(),
    email: z.string().email().max(320).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const updates: Record<string, any> = {};

    // Use !== undefined so that empty strings are also written (allows clearing a value)
    if (input.fullName !== undefined && input.fullName.trim().length > 0) {
      updates.fullName = input.fullName.trim();
    }
    if (input.phone !== undefined) {
      updates.phone = input.phone.replace(/[^0-9]/g, '');
    }
    if (input.ashrayLevel !== undefined && input.ashrayLevel.length > 0) {
      updates.ashrayLevel = input.ashrayLevel;
    }
    // Linked record fields — pass the record ID directly
    if (input.guideId) updates.guide = input.guideId;
    if (input.residencyId) updates.residency = input.residencyId;

    if (Object.keys(updates).length === 0) return { success: true };

    // Primary write: use Zite user sync record ID (guaranteed to match the right row)
    await Users.update({ id: context.user.id, record: updates });

    // Invalidate cached profile so next load reflects the change
    serverCacheInvalidate(`user_profile:${context.user.id}`);

    return { success: true };
  },
});
