import { z } from 'zod';
import { createEndpoint, CleanlinessReviewRequests, CleanlinessInspections, SadhanaEntries, Users, AppError } from '@/lib/backend-sdk';

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
    if (!review) throw new AppError({ code: 'NOT_FOUND', message: 'Review not found' });
    if (String(review.status || '').trim().toUpperCase() !== 'PENDING') throw new AppError({ code: 'CONFLICT', message: 'Review already resolved' });

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
      const rawUserId = Array.isArray(review.user) ? review.user[0] : review.user;
      const userRecord = rawUserId
        ? await Users.findOne({ id: rawUserId, fields: ['id', 'userId', 'email'] }).catch(() => null) ||
          await Users.findOne({ filters: { userId: rawUserId }, fields: ['id', 'userId', 'email'] }).catch(() => null) ||
          await Users.findOne({ filters: { email: rawUserId }, fields: ['id', 'userId', 'email'] }).catch(() => null)
        : null;
      const userIds = [...new Set([rawUserId, (userRecord as any)?.id, (userRecord as any)?.userId, (userRecord as any)?.email].filter(Boolean))];
      const date = review.date;
      if (userIds.length > 0 && date) {
        const { records: entries } = await SadhanaEntries.findAll({ filters: { user: { in: userIds }, entryDate: date } as any, limit: 1 });
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
