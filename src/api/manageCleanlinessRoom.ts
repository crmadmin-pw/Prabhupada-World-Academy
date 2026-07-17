import { z } from 'zod';
import { createEndpoint, CleanlinessRooms } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Create, update, or delete cleanliness rooms',
  authenticated: true,
  inputSchema: z.object({
    action: z.enum(['create', 'update', 'delete']),
    roomId: z.string().optional(),
    roomNumber: z.string().optional(),
    residencyId: z.string().optional(),
    occupantIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const { action, roomId, roomNumber, residencyId, occupantIds } = input;

    if (action === 'create') {
      const record = await CleanlinessRooms.create({
        record: {
          roomNumber: roomNumber || '',
          residency: residencyId ? [residencyId] : undefined,
          occupants: occupantIds || [],
        },
      });
      return { success: true, room: record };
    }

    if (action === 'update') {
      const result = await CleanlinessRooms.update({
        id: roomId,
        record: {
          roomNumber: roomNumber || undefined,
          occupants: occupantIds || [],
        },
      });
      return { success: true, room: result };
    }

    if (action === 'delete') {
      await CleanlinessRooms.delete({ id: roomId! });
      return { success: true };
    }

    return { success: false };
  },
});
