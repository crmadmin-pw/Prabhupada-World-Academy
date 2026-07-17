import { z } from 'zod';
import { createEndpoint, CleanlinessReviewRequests, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Request a cleanliness review when score is 0',
  authenticated: true,
  inputSchema: z.object({
    inspectionId: z.string(),
    roomId: z.string(),
    date: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean(), reviewId: z.string() }),
  execute: async ({ input, context }) => {
    const userId = context.user.id;

    // Check if a review already exists
    const { records } = await CleanlinessReviewRequests.findAll({
      filters: { user: userId, date: input.date } as any,
      limit: 1,
    });
    if (records.length > 0) {
      throw new ZiteError({ code: 'CONFLICT', message: 'Review already requested for this date' });
    }

    const created = await CleanlinessReviewRequests.create({
      record: {
        user: userId,
        room: input.roomId,
        date: input.date,
        inspection: input.inspectionId,
        status: 'Pending',
      },
    });

    return { success: true, reviewId: created.id };
  },
});
