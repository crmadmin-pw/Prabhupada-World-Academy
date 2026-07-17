import { z } from 'zod';
import { createEndpoint, ZiteError, ChallengeEnrollments, AttendanceSessions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Join a challenge for a session (public)',
  inputSchema: z.object({
    sessionId: z.string(),
    userId: z.string().optional(),
    participantId: z.string().optional(),
  }),
  outputSchema: z.object({
    enrollmentId: z.string(),
    currentStreak: z.number(),
    challengeDays: z.number(),
  }),
  execute: async ({ input }) => {
    const session = await AttendanceSessions.findOne({ id: input.sessionId });
    if (!session || !session.challengeEnabled) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Challenge not available' });
    if (!input.userId && !input.participantId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'userId or participantId required' });

    // Check existing
    const filters: any = { session: input.sessionId };
    if (input.userId) filters.user = input.userId;
    if (input.participantId) filters.participant = input.participantId;
    const existing = await ChallengeEnrollments.findOne({ filters });
    if (existing) {
      return { enrollmentId: existing.id, currentStreak: existing.currentStreak || 0, challengeDays: session.challengeDays || 7 };
    }

    const today = new Date().toISOString().slice(0, 10);
    const record: any = { session: input.sessionId, currentStreak: 1, lastAttendanceDate: today, status: 'Active' };
    if (input.userId) record.user = input.userId;
    if (input.participantId) record.participant = input.participantId;
    const enrollment = await ChallengeEnrollments.create({ record });

    return { enrollmentId: enrollment.id, currentStreak: 1, challengeDays: session.challengeDays || 7 };
  },
});
