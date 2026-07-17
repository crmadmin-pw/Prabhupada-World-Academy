import { z } from 'zod';
import { createEndpoint, CleanlinessRooms, CleanlinessInspections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get cleanliness inspections for a residency and optional date',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string(),
    date: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // First get all rooms for this residency
    const { records: rooms } = await CleanlinessRooms.findAll({
      filters: { residency: input.residencyId },
      fields: ['id'],
      limit: 500,
    });

    if (rooms.length === 0) {
      return { inspections: [] };
    }

    const roomIds = rooms.map(r => r.id);

    // Now get inspections for those rooms
    const filters: any = { room: { in: roomIds } };
    if (input.date) {
      filters.date = input.date;
    }

    const { records } = await CleanlinessInspections.findAll({
      filters,
      limit: 2000,
    });

    const inspections = records.map(r => {
      const roomId = Array.isArray(r.room) ? r.room[0] : r.room;
      const photo = Array.isArray(r.photo) && r.photo.length > 0 ? r.photo[0].url : null;
      return {
        id: r.id,
        roomId: roomId || '',
        score: r.score ?? null,
        photo,
        comment: r.comment || '',
        date: r.date || '',
      };
    });

    return { inspections };
  },
});
