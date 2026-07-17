import { z } from 'zod';
import { createEndpoint, CleanlinessReviewRequests, CleanlinessInspections, SadhanaEntries, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Approve or dismiss a cleanliness review request',
  authenticated: true,
  inputSchema: z.object({
    reviewId: z.string(),
    action: z.enum(['approve', 'dismiss']),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const review = await CleanlinessReviewRequests.findOne({ id: input.reviewId });
    if (!review) throw new ZiteError({ code: 'NOT_FOUND', message: 'Review not found' });
    if (review.status !== 'Pending') throw new ZiteError({ code: 'CONFLICT', message: 'Review already resolved' });

    if (input.action === 'approve') {
      // Update inspection score to 1
      const inspectionId = Array.isArray(review.inspection) ? review.inspection[0] : review.inspection;
      if (inspectionId) {
        await CleanlinessInspections.update({
          id: inspectionId,
          record: { score: 1 },
        });
      }

      // Find and update the sadhana entry for this date + user
      const userId = Array.isArray(review.user) ? review.user[0] : review.user;
      const date = review.date;
      if (userId && date) {
        const { records: entries } = await SadhanaEntries.findAll({
          filters: { user: userId, entryDate: date } as any,
          limit: 1,
        });
        if (entries.length > 0) {
          const entry = entries[0];
          const oldCleanliness = Number((entry as any).cleanlinessPoints ?? 0);
          const newCleanliness = 1;
          const diff = newCleanliness - oldCleanliness;
          if (diff !== 0) {
            const newTotal = Number(entry.totalScore ?? 0) + diff;
            const maxScore = Number(entry.maxScore ?? 20);
            const newPct = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((newTotal / maxScore) * 100))) : 0;
            await SadhanaEntries.update({
              id: entry.id,
              record: {
                cleanlinessPoints: newCleanliness,
                totalScore: newTotal,
                scorePercent: newPct,
              } as any,
            });
          }
        }
      }
    }

    // Update review status
    await CleanlinessReviewRequests.update({
      id: input.reviewId,
      record: {
        status: input.action === 'approve' ? 'Approved' : 'Dismissed',
        reviewedBy: context.user.id,
      },
    });

    return { success: true };
  },
});
