import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Save BV session attendance for a group and date. Idempotent — creates the session if needed, updates existing attendance. Also writes attendanceDate and group directly to attendance records.',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(),
    groupId: z.string(),
    sessionDate: z.string(),
    presentUserIds: z.array(z.string()), // DB UUIDs of users marked present
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Resolve group — try custom groupId first, then DB UUID
    let group = await BvGroups.findOne({
      filters: { groupId: input.groupId },
      fields: ['id', 'groupId', 'groupName'],
    });
    if (!group) {
      group = await BvGroups.findOne({
        id: input.groupId,
        fields: ['id', 'groupId', 'groupName'],
      }).catch(() => undefined);
    }
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    // Find or create the session for this group+date (kept for backward compat)
    let session = await BvSessions.findOne({
      filters: { group: group.id, sessionDate: input.sessionDate },
      fields: ['id'],
    });
    if (!session) {
      session = await BvSessions.create({
        record: {
          group: group.id,
          sessionDate: input.sessionDate,
          conductedAt: new Date().toISOString(),
        },
      });
    }

    // Get all current group members (skip orphaned ones without a linked user)
    const { records: members } = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user'],
      limit: 500,
    });
    const validMembers = members.filter((m: any) => {
      const uid = Array.isArray(m.user) ? m.user[0] : m.user;
      return !!uid;
    });

    // Load existing attendance records for this group+date (new approach)
    const { records: existingAtt } = await BvAttendance.findAll({
      filters: { group: group.id, attendanceDate: input.sessionDate },
      fields: ['id', 'user'],
      limit: 500,
    });
    const attByUserDbId: Record<string, string> = {};
    existingAtt.forEach((a: any) => {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user as string;
      if (uid) attByUserDbId[uid] = a.id;
    });

    const presentSet = new Set(input.presentUserIds);

    // Split into records to update vs records to create
    const toUpdate: { id: string; present: boolean }[] = [];
    const toCreate: { session: string; user: string; present: boolean; attendanceDate: string; group: string }[] = [];

    for (const m of validMembers) {
      const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
      const isPresent = presentSet.has(dbId);
      if (attByUserDbId[dbId]) {
        toUpdate.push({ id: attByUserDbId[dbId], present: isPresent });
      } else {
        toCreate.push({
          session: session.id,
          user: dbId,
          present: isPresent,
          attendanceDate: input.sessionDate,
          group: group.id,
        });
      }
    }

    // Update existing attendance records
    await Promise.all(toUpdate.map(u => BvAttendance.update({ id: u.id, record: { present: u.present } })));

    // Bulk create new attendance records (chunks of 100)
    for (let i = 0; i < toCreate.length; i += 100) {
      await BvAttendance.bulkCreate({ records: toCreate.slice(i, i + 100) });
    }

    return {
      success: true,
      sessionId: session.id,
      message: `Attendance saved for ${group.groupName} — ${input.presentUserIds.length}/${validMembers.length} present`,
    };
  },
});
