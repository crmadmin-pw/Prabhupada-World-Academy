import { z } from 'zod';
import { createEndpoint, CleanlinessReviewRequests, CleanlinessInspections, CleanlinessRooms, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get pending cleanliness review requests for guide',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Get all pending reviews
    const { records: reviews } = await CleanlinessReviewRequests.findAll({
      filters: { status: 'Pending' },
      limit: 100,
    });

    if (reviews.length === 0) return [];

    // Enrich with user, room, and inspection data
    const enriched = await Promise.all(reviews.map(async (r) => {
      const [user, room, inspection] = await Promise.all([
        r.user ? Users.findOne({ id: Array.isArray(r.user) ? r.user[0] : r.user }) : null,
        r.room ? CleanlinessRooms.findOne({ id: Array.isArray(r.room) ? r.room[0] : r.room }) : null,
        r.inspection ? CleanlinessInspections.findOne({ id: Array.isArray(r.inspection) ? r.inspection[0] : r.inspection }) : null,
      ]);

      // Filter by guide — only show reviews for users under this guide
      const userGuide = user?.guide;
      const guideId = Array.isArray(userGuide) ? userGuide[0] : userGuide;
      if (input.guideId !== 'ALL' && guideId !== input.guideId) return null;

      return {
        reviewId: r.id,
        date: r.date,
        status: r.status,
        userName: user?.userId || 'Unknown',
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
