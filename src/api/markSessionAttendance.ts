import { z } from 'zod';
import {
  createEndpoint, ZiteError, Users, AttendanceParticipants,
  AttendanceRecords, AttendanceSessions, ChallengeEnrollments,
} from 'zite-integrations-backend-sdk';
import { normalizePhone } from '@/lib/phoneNormalize';

export default createEndpoint({
  description: 'Mark attendance for a session by phone or userId (public)',
  inputSchema: z.object({
    sessionId: z.string(),
    phone: z.string().optional(),
    userId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    alreadyMarked: z.boolean(),
    participantName: z.string(),
    source: z.string(),
    challengeEnabled: z.boolean(),
    enrollmentId: z.string().optional(),
    currentStreak: z.number().optional(),
    challengeDays: z.number().optional(),
  }),
  execute: async ({ input }) => {
    const today = new Date().toISOString().slice(0, 10);
    const session = await AttendanceSessions.findOne({ id: input.sessionId });
    if (!session) throw new ZiteError({ code: 'NOT_FOUND', message: 'Session not found' });

    let userId: string | undefined;
    let participantId: string | undefined;
    let participantName = '';
    let source: 'Registered User' | 'New Participant' = 'Registered User';

    if (input.userId) {
      const user = await Users.findOne({ id: input.userId });
      if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
      userId = user.id;
      participantName = user.fullName || user.email || '';
      source = 'Registered User';
    } else if (input.phone) {
      const norm = normalizePhone(input.phone);
      // Search Users first
      const { records: users } = await Users.findAll({ filters: { phone: { contains: norm.replace('+', '') } }, limit: 5 });
      const matchedUser = users.find(u => normalizePhone(u.phone || '') === norm);
      if (matchedUser) {
        userId = matchedUser.id;
        participantName = matchedUser.fullName || matchedUser.email || '';
        source = 'Registered User';
      } else {
        // Search Participants
        const { records: parts } = await AttendanceParticipants.findAll({ filters: { phone: { contains: norm.replace('+', '') } }, limit: 5 });
        const matchedPart = parts.find(p => normalizePhone(p.phone || '') === norm);
        if (matchedPart) {
          participantId = matchedPart.id;
          participantName = matchedPart.name || '';
          source = 'New Participant';
        } else {
          throw new ZiteError({ code: 'NOT_FOUND', message: 'Phone not found. Try your registered number or register now.' });
        }
      }
    } else {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Phone or userId required' });
    }

    // Check duplicate
    const dupFilters: any = { session: input.sessionId, date: today };
    if (userId) dupFilters.user = userId;
    if (participantId) dupFilters.participant = participantId;
    const existing = await AttendanceRecords.findOne({ filters: dupFilters });
    if (existing) {
      // Still return challenge info
      let enrollment: any = undefined;
      if (session.challengeEnabled) {
        const eFilters: any = { session: input.sessionId };
        if (userId) eFilters.user = userId;
        if (participantId) eFilters.participant = participantId;
        enrollment = await ChallengeEnrollments.findOne({ filters: eFilters });
      }
      return {
        success: true, alreadyMarked: true, participantName, source,
        challengeEnabled: session.challengeEnabled || false,
        enrollmentId: enrollment?.id,
        currentStreak: enrollment?.currentStreak,
        challengeDays: session.challengeDays || 7,
      };
    }

    // Create record
    const record: any = { session: input.sessionId, date: today, source };
    if (userId) record.user = userId;
    if (participantId) record.participant = participantId;
    await AttendanceRecords.create({ record });

    // Update challenge enrollment streak
    let enrollment: any = undefined;
    if (session.challengeEnabled) {
      const eFilters: any = { session: input.sessionId };
      if (userId) eFilters.user = userId;
      if (participantId) eFilters.participant = participantId;
      enrollment = await ChallengeEnrollments.findOne({ filters: eFilters });
      if (enrollment) {
        const lastDate = enrollment.lastAttendanceDate || '';
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let newStreak = 1;
        if (lastDate === yesterday) {
          newStreak = (enrollment.currentStreak || 0) + 1;
        } else if (lastDate === today) {
          newStreak = enrollment.currentStreak || 1;
        }
        const status = newStreak >= (session.challengeDays || 7) ? 'Completed' : 'Active';
        await ChallengeEnrollments.update({ id: enrollment.id, record: { currentStreak: newStreak, lastAttendanceDate: today, status } });
        enrollment.currentStreak = newStreak;
      }
    }

    return {
      success: true, alreadyMarked: false, participantName, source,
      challengeEnabled: session.challengeEnabled || false,
      enrollmentId: enrollment?.id,
      currentStreak: enrollment?.currentStreak,
      challengeDays: session.challengeDays || 7,
    };
  },
});
