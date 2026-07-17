import { z } from 'zod';
import {
  createEndpoint, ZiteError, AttendanceParticipants, AttendanceRecords,
  AttendanceSessions, Users,
} from 'zite-integrations-backend-sdk';
import { normalizePhone } from '@/lib/phoneNormalize';

export default createEndpoint({
  description: 'Register a new participant and mark attendance (public)',
  inputSchema: z.object({
    sessionId: z.string(),
    name: z.string(),
    phone: z.string(),
    email: z.string().optional(),
    customData: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    participantId: z.string(),
    participantName: z.string(),
  }),
  execute: async ({ input }) => {
    const session = await AttendanceSessions.findOne({ id: input.sessionId });
    if (!session) throw new ZiteError({ code: 'NOT_FOUND', message: 'Session not found' });

    const eventId = Array.isArray(session.event) ? session.event[0] : session.event;
    const norm = normalizePhone(input.phone);

    // Check if phone exists in Users
    const { records: users } = await Users.findAll({ filters: { phone: { contains: norm.replace('+', '') } }, limit: 5 });
    if (users.some(u => normalizePhone(u.phone || '') === norm)) {
      throw new ZiteError({ code: 'CONFLICT', message: 'This phone is already registered as a user. Please use the attendance form instead.' });
    }

    // Check if phone exists in Participants
    const { records: parts } = await AttendanceParticipants.findAll({ filters: { phone: { contains: norm.replace('+', '') } }, limit: 5 });
    if (parts.some(p => normalizePhone(p.phone || '') === norm)) {
      throw new ZiteError({ code: 'CONFLICT', message: 'This phone is already registered. Please use the attendance form instead.' });
    }

    const participant = await AttendanceParticipants.create({
      record: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        customData: input.customData,
        event: eventId,
      },
    });

    const today = new Date().toISOString().slice(0, 10);
    await AttendanceRecords.create({
      record: {
        session: input.sessionId,
        date: today,
        participant: participant.id,
        source: 'New Participant',
      },
    });

    return { success: true, participantId: participant.id, participantName: input.name };
  },
});
