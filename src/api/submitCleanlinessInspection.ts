import { z } from 'zod';
import { createEndpoint, CleanlinessInspections } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Submit or update a cleanliness inspection for a room on a given date',
  authenticated: true,
  inputSchema: z.object({
    roomId: z.string(),
    residencyId: z.string().optional(),
    date: z.string(),
    score: z.number().optional(),
    isClean: z.boolean().optional(),
    comment: z.string().optional(),
    notes: z.string().optional(),
    photoUrl: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const { roomId, residencyId, date, score, comment, notes, photoUrl } = input;

    // Check for existing inspection for this room + date using { in: } for linked record reliability
    const { records: existing } = await CleanlinessInspections.findAll({
      filters: {
        room: { in: [roomId] },
        date,
      },
      limit: 1,
    });

    const photo = photoUrl ? [{ url: photoUrl }] : undefined;
    const finalComment = comment || notes || undefined;

    if (existing.length > 0) {
      await CleanlinessInspections.update({
        id: existing[0].id,
        record: {
          score: score ?? undefined,
          comment: finalComment,
          photo: photo ?? undefined,
          inspector: [context.user.id],
        },
      });
    } else {
      await CleanlinessInspections.create({
        record: {
          room: [roomId],
          residency: residencyId ? [residencyId] : undefined,
          date,
          score: score ?? undefined,
          comment: finalComment,
          photo,
          inspector: [context.user.id],
        },
      });
    }

    return { success: true };
  },
});
