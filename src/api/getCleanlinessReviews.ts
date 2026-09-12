import { z } from 'zod';
import { createEndpoint, CleanlinessReviewRequests, CleanlinessInspections, CleanlinessRooms, Users, Guides } from '@/lib/backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Get pending cleanliness review requests for guide',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    // Get all pending reviews
    const { records: rawReviews } = await CleanlinessReviewRequests.findAll({ limit: 500 });
    const reviews = rawReviews.filter((review: any) =>
      String(review.status || '').trim().toUpperCase() === 'PENDING'
    );

    if (reviews.length === 0) return [];

    // Enrich with user, room, and inspection data
    const callerRole = String(context?.user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
    const scopedGuideId = String(input?.guideId || '').trim();
    const isSuperGuide = (!scopedGuideId || scopedGuideId === 'ALL') && (callerRole === 'SUPER_GUIDE' || callerRole === 'SUPER_ADMIN' || !!context?.user?.isBvSuperAdmin);
    const scope = !isSuperGuide
      ? await getGuideScope(context?.user?.email || '')
      : null;

    const enriched = await Promise.all(reviews.map(async (r) => {
      const rawUserRef = Array.isArray(r.user) ? r.user[0] : r.user;
      const [user, room, inspection] = await Promise.all([
        rawUserRef
          ? await Users.findOne({ id: rawUserRef }).catch(() => null) ||
            await Users.findOne({ filters: { userId: rawUserRef } }).catch(() => null) ||
            await Users.findOne({ filters: { email: rawUserRef } }).catch(() => null)
          : null,
        r.room ? CleanlinessRooms.findOne({ id: Array.isArray(r.room) ? r.room[0] : r.room }) : null,
        r.inspection ? CleanlinessInspections.findOne({ id: Array.isArray(r.inspection) ? r.inspection[0] : r.inspection }) : null,
      ]);

      // Filter by guide — only show reviews for users under this guide
      if (!isSuperGuide) {
        if (!scope || !isUserInGuideScope(scope, user)) return null;
      } else if (input.guideId !== 'ALL' && input.guideId) {
        const userGuide = user?.guide;
        const guideId = Array.isArray(userGuide) ? userGuide[0] : userGuide;
        if (guideId !== input.guideId) return null;
      }

      return {
        reviewId: r.id,
        date: r.date,
        status: r.status,
        userName: user?.fullName || user?.userId || 'Unknown',
        userFullName: user?.fullName || user?.userId || 'Unknown',
        userEmail: user?.email,
        userRecordId: user?.id,
        roomNumber: room?.roomNumber || '?',
        inspectionId: inspection?.id,
        photo: (inspection?.photo as any)?.[0]?.url || null,
        comment: inspection?.comment || null,
        score: inspection?.score ?? 0,
      };
    }));

    return enriched.filter(Boolean);
  },
});
