import { z } from 'zod';
import { createEndpoint, Users, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { getUserSegment, resolveGuideReference } from '../lib/guideResolution';

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
  execute: async ({ input, context }: any) => {
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
    if (input.guideId) {
      const guide = await resolveGuideReference(input.guideId);
      if (!guide) throw new AppError({ code: 'NOT_FOUND', message: 'Selected guide or admin was not found.' });
      const stored = await Users.findOne({
        id: context.user.id,
        fields: ['segment', 'isPrabhupadaWorldUser', 'isFolkUser'],
      });
      const currentProgram = getUserSegment(stored || context.user);
      if (currentProgram && guide.segment && guide.segment !== currentProgram) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You cannot change your program.' });
      }
      updates.guide = input.guideId;
    }
    if (input.residencyId) updates.residency = input.residencyId;

    if (Object.keys(updates).length === 0) return { success: true };

    // Primary write: use App user sync record ID (guaranteed to match the right row)
    await Users.update({ id: context.user.id, record: updates });

    // Invalidate cached profile so next load reflects the change
    serverCacheInvalidate(`user_profile:${context.user.id}`);

    return { success: true };
  },
});
