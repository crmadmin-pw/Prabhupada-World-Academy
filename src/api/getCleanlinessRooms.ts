import { z } from 'zod';
import { createEndpoint, Config, CleanlinessRooms, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get all cleanliness rooms for a residency',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string(),
    date: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const configRow = await Config.findOne({ filters: { configKey: `cleanliness_enabled_${input.residencyId}` } });
    const enabled = configRow?.configValue === 'true';

    const { records } = await CleanlinessRooms.findAll({
      filters: { residency: input.residencyId },
      limit: 500,
    });

    // Batch fetch occupant names
    const allOccIds = new Set<string>();
    for (const room of records) {
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

    const rooms = records.map(r => {
      const occIds = Array.isArray(r.occupants) ? r.occupants : (r.occupants ? [r.occupants] : []);
      return {
        roomId: r.id,
        roomNumber: r.roomNumber || '',
        occupants: (occIds as string[]).map(id => ({ id, name: nameMap.get(id) || '' })),
      };
    });

    return { rooms, enabled };
  },
});
