import { z } from 'zod';
import { createEndpoint, BvSessions, BvAttendance, BvGroupMembers, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Mark a user present or absent in a specific BV session, or by date',
  authenticated: true,
  inputSchema: z.object({
    sessionId: z.string().optional(),
    userId: z.string().optional(),
    present: z.boolean().optional(),
    status: z.string().optional(),
    localDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const isPresent = input.present ?? (input.status === 'P');
    const uid = input.userId || context.user!.id;

    // If sessionId is given, mark attendance for that session
    if (input.sessionId) {
      const session = await BvSessions.findOne({
        id: input.sessionId,
        fields: ['id', 'sessionDate', 'group'],
      });
      if (!session) throw new ZiteError({ code: 'NOT_FOUND', message: 'Session not found' });

      const sessionDate = String(session.sessionDate || '').slice(0, 10);
      const groupId = Array.isArray(session.group) ? session.group[0] : session.group as string | undefined;

      // Try to find existing record by group+date (new approach) or by session (legacy)
      let existing = groupId && sessionDate
        ? await BvAttendance.findOne({ filters: { group: groupId, attendanceDate: sessionDate, user: uid } })
        : await BvAttendance.findOne({ filters: { session: input.sessionId, user: uid } });

      if (existing) {
        await BvAttendance.update({ id: existing.id, record: { present: isPresent } });
      } else {
        await BvAttendance.create({
          record: {
            session: input.sessionId,
            user: uid,
            present: isPresent,
            ...(sessionDate ? { attendanceDate: sessionDate } : {}),
            ...(groupId ? { group: groupId } : {}),
          },
        });
      }
      return { success: true };
    }

    // If localDate given — find user's group and mark attendance directly by group+date
    if (input.localDate) {
      // Get user's group membership
      const membershipRes = await BvGroupMembers.findAll({
        filters: { user: uid },
        limit: 1,
        fields: ['id', 'group'],
      });
      const groupId = membershipRes.records[0]
        ? (Array.isArray(membershipRes.records[0].group) ? membershipRes.records[0].group[0] : membershipRes.records[0].group as string)
        : null;

      if (!groupId) {
        // Not in a group — silently succeed
        return { success: true };
      }

      // Try new approach: find by group+date
      const existing = await BvAttendance.findOne({
        filters: { group: groupId, attendanceDate: input.localDate, user: uid },
      });

      if (existing) {
        await BvAttendance.update({ id: existing.id, record: { present: isPresent } });
      } else {
        // Check if there's a session for this date to link to (backward compat)
        const session = await BvSessions.findOne({
          filters: { group: groupId, sessionDate: input.localDate },
          fields: ['id'],
        });
        await BvAttendance.create({
          record: {
            user: uid,
            present: isPresent,
            attendanceDate: input.localDate,
            group: groupId,
            ...(session ? { session: session.id } : {}),
          },
        });
      }
      return { success: true };
    }

    throw new ZiteError({ code: 'BAD_REQUEST', message: 'sessionId or localDate is required' });
  },
});
