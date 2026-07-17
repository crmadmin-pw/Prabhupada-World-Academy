import { z } from 'zod';
import { createEndpoint, AttendanceSessions, AttendanceEvents } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Look up an attendance session by its share token (public)',
  inputSchema: z.object({ token: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    session: z.object({
      id: z.string(),
      name: z.string(),
      eventId: z.string(),
      eventTitle: z.string(),
      eventDescription: z.string(),
      customFields: z.string(),
      challengeEnabled: z.boolean(),
      challengeTitle: z.string(),
      challengeDescription: z.string(),
      challengeImageUrl: z.string(),
      challengeInstructions: z.string(),
      challengeDays: z.number(),
    }).optional(),
  }),
  execute: async ({ input }) => {
    const session = await AttendanceSessions.findOne({ filters: { shareToken: input.token } });
    if (!session) return { found: false };

    const eventId = Array.isArray(session.event) ? session.event[0] : session.event;
    const event = eventId ? await AttendanceEvents.findOne({ id: eventId }) : undefined;

    return {
      found: true,
      session: {
        id: session.id,
        name: session.name || '',
        eventId: eventId || '',
        eventTitle: event?.title || '',
        eventDescription: event?.description || '',
        customFields: event?.customFields || '[]',
        challengeEnabled: session.challengeEnabled || false,
        challengeTitle: session.challengeTitle || '',
        challengeDescription: session.challengeDescription || '',
        challengeImageUrl: session.challengeImage?.[0]?.url || '',
        challengeInstructions: session.challengeInstructions || '',
        challengeDays: session.challengeDays || 7,
      },
    };
  },
});
