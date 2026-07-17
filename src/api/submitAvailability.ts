import { z } from 'zod';
import { createEndpoint, ServiceAvailability, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Submit or update availability for the current user (or a resident if guide is submitting on their behalf)',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(),
    availableDaysJson: z.string(),
    userId: z.string().optional(), // If provided and caller is Guide/Super Guide, submit for that user
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const isGuide = callerRole === 'Guide' || callerRole === 'Super Guide' || callerRole === 'Sadhana Mentor'
      || context.user.isServiceAllocator === true;

    // Determine target user
    let targetUserId = context.user.id;
    if (input.userId && input.userId !== context.user.id) {
      if (!isGuide) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or service allocators can submit availability on behalf of residents' });
      }
      targetUserId = input.userId;
    }

    const existing = await ServiceAvailability.findOne({
      filters: { user: targetUserId, weekDate: input.weekStartDate },
    });

    if (existing) {
      await ServiceAvailability.update({ id: existing.id, record: { availableDaysJson: input.availableDaysJson } });
    } else {
      await ServiceAvailability.create({ record: {
        user: targetUserId,
        weekDate: input.weekStartDate,
        availableDaysJson: input.availableDaysJson,
      }});
    }
    return { success: true, submittedFor: targetUserId };
  },
});
