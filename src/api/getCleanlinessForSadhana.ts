import { z } from 'zod';
import { createEndpoint, Config, CleanlinessRooms, CleanlinessInspections, CleanlinessReviewRequests } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get cleanliness inspection score for sadhana form auto-fill',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    residencyId: z.string().optional(),
    date: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const rid = input.residencyId;
    if (!rid) return { enabled: false, score: null, pending: false };

    const configRow = await Config.findOne({ filters: { configKey: `cleanliness_enabled_${rid}` } });
    const enabled = configRow?.configValue === 'true';
    if (!enabled) return { enabled: false, score: null, pending: false };

    const date = input.date || new Date().toISOString().split('T')[0];
    const userRecordId = context.user.id;

    // Find the user's room via occupants
    const { records: rooms } = await CleanlinessRooms.findAll({
      filters: { residency: rid, occupants: { contains: userRecordId } } as any,
      limit: 5,
    });

    if (rooms.length === 0) {
      return { enabled: true, score: null, pending: true, message: 'No room assigned' };
    }

    const room = rooms[0];

    // Find inspection for this room + date
    const { records: inspections } = await CleanlinessInspections.findAll({
      filters: { room: room.id, date } as any,
      limit: 1,
    });

    if (inspections.length === 0) {
      return { enabled: true, score: null, pending: true, roomNumber: room.roomNumber };
    }

    const inspection = inspections[0];
    const score = inspection.score ?? 0;

    // Check if user has a pending review request for this date
    const { records: reviews } = await CleanlinessReviewRequests.findAll({
      filters: { user: userRecordId, date } as any,
      limit: 1,
    });
    const reviewStatus = reviews.length > 0 ? reviews[0].status : null;

    return {
      enabled: true,
      score,
      pending: false,
      roomNumber: room.roomNumber,
      inspectionId: inspection.id,
      roomId: room.id,
      // Include photo/comment when score is 0
      ...(score === 0 ? {
        photo: (inspection.photo as any)?.[0]?.url || null,
        comment: inspection.comment || null,
      } : {}),
      reviewStatus,
    };
  },
});
