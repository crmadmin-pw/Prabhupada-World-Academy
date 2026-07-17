import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { CleanlinessRooms, CleanlinessInspections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get cleanliness analytics and managers for a residency',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // 1. Get managers: users with isCleanlinessManager who are residents in this residency
    const { records: managerRecords } = await Users.findAll({
      filters: { isCleanlinessManager: true } as any,
      fields: ['id', 'fullName', 'residency'],
      limit: 200,
    });
    const managers = managerRecords
      .filter(m => {
        const res = Array.isArray(m.residency) ? m.residency : (m.residency ? [m.residency] : []);
        return res.includes(input.residencyId);
      })
      .map(m => ({ id: m.id, name: (m as any).fullName || '' }));

    // 2. Get rooms for this residency
    const { records: rooms } = await CleanlinessRooms.findAll({
      filters: { residency: input.residencyId },
      fields: ['id', 'roomNumber', 'occupants'],
      limit: 500,
    });

    if (!rooms.length || !input.startDate || !input.endDate) {
      return { managers, analytics: [] };
    }

    // 3. Get all inspections in the date range for these rooms
    const { records: inspections } = await CleanlinessInspections.findAll({
      filters: {
        room: { in: rooms.map(r => r.id) },
        date: { gte: input.startDate, lte: input.endDate },
      },
      fields: ['id', 'room', 'date', 'score'],
      limit: 2000,
    });

    // Build room stats: roomId -> { cleanDays, totalDays }
    const roomStats = new Map<string, { cleanDays: number; totalDays: number }>();
    for (const insp of inspections) {
      const roomId = Array.isArray(insp.room) ? insp.room[0] : insp.room;
      if (!roomId) continue;
      const stat = roomStats.get(roomId as string) || { cleanDays: 0, totalDays: 0 };
      stat.totalDays++;
      if (insp.score === 1) stat.cleanDays++;
      roomStats.set(roomId as string, stat);
    }

    // Batch fetch occupant names
    const allOccIds = new Set<string>();
    for (const room of rooms) {
      const occ = Array.isArray(room.occupants) ? room.occupants : (room.occupants ? [room.occupants] : []);
      occ.forEach(id => allOccIds.add(id as string));
    }
    const nameMap = new Map<string, string>();
    if (allOccIds.size > 0) {
      const { records: users } = await Users.findAll({
        filters: { id: { in: Array.from(allOccIds) } },
        fields: ['id', 'fullName'],
        limit: 500,
      });
      for (const u of users) nameMap.set(u.id, (u as any).fullName || '');
    }

    // Build per-occupant analytics
    const analytics: any[] = [];
    for (const room of rooms) {
      const stat = roomStats.get(room.id) || { cleanDays: 0, totalDays: 0 };
      if (stat.totalDays === 0) continue;
      const occIds = Array.isArray(room.occupants) ? room.occupants : (room.occupants ? [room.occupants] : []);
      for (const uid of occIds) {
        analytics.push({
          userId: uid,
          name: nameMap.get(uid as string) || 'Unknown',
          roomNumber: room.roomNumber || '',
          cleanDays: stat.cleanDays,
          totalDays: stat.totalDays,
          percentage: Math.round((stat.cleanDays / stat.totalDays) * 100),
        });
      }
    }

    // Sort by percentage ascending so worst appears at top
    analytics.sort((a, b) => a.percentage - b.percentage);

    return { managers, analytics };
  },
});
