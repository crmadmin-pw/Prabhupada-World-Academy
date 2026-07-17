import { z } from 'zod';
import { createEndpoint, CleanlinessRooms, CleanlinessInspections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get user cleanliness calendar — finds user room and all inspections',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    residencyId: z.string(),
    month: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const userRecordId = context.user.id;

    // Find the user's room via occupants
    const { records: rooms } = await CleanlinessRooms.findAll({
      filters: { residency: input.residencyId, occupants: { contains: userRecordId } } as any,
      limit: 5,
    });

    if (rooms.length === 0) {
      return { days: [], summary: { cleanDays: 0, totalDays: 0, percentage: 0 }, roomNumber: null, noRoom: true };
    }

    const room = rooms[0];

    // Fetch all inspections for this room
    const { records: inspections } = await CleanlinessInspections.findAll({
      filters: { room: { in: [room.id] } } as any,
      limit: 200,
    });

    // Build day records sorted by date descending
    const days = inspections
      .filter(i => i.date)
      .map(i => ({
        id: i.id,
        date: i.date!,
        score: i.score ?? 0,
        comment: i.comment || '',
        photo: (i.photo as any)?.[0]?.url || null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const totalDays = days.length;
    const cleanDays = days.filter(d => d.score === 1).length;
    const percentage = totalDays > 0 ? Math.round((cleanDays / totalDays) * 100) : 0;

    return {
      days,
      summary: { cleanDays, totalDays, percentage },
      roomNumber: room.roomNumber || '',
      noRoom: false,
    };
  },
});
