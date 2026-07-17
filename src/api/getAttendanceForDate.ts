import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get member list with existing attendance for a specific group and date',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string(),
    date: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Resolve group — try custom groupId field first, then DB UUID
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

    // Get group members
    const { records: memberRecords } = await BvGroupMembers.findAll({
      filters: { group: group.id },
      fields: ['id', 'user'],
      limit: 200,
    });

    const userDbIds = memberRecords
      .map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user)
      .filter(Boolean) as string[];

    const { records: userRecords } = userDbIds.length > 0
      ? await Users.findAll({ filters: { id: { in: userDbIds } }, fields: ['id', 'userId', 'fullName'], limit: 500 })
      : { records: [] };

    const userMap: Record<string, any> = {};
    userRecords.forEach((u: any) => { userMap[u.id] = u; });

    // Query attendance directly by group + date (new approach)
    const { records: directAttRecords } = await BvAttendance.findAll({
      filters: { group: group.id, attendanceDate: input.date },
      fields: ['id', 'user', 'present'],
      limit: 500,
    });

    const attendanceMap: Record<string, boolean | null> = {};
    let sessionExists = directAttRecords.length > 0;

    if (directAttRecords.length > 0) {
      directAttRecords.forEach((a: any) => {
        const uid = Array.isArray(a.user) ? a.user[0] : a.user;
        if (uid) attendanceMap[uid] = a.present ?? null;
      });
    } else {
      // Backward compat: fall back to session-based lookup
      const session = await BvSessions.findOne({
        filters: { group: group.id, sessionDate: input.date },
        fields: ['id'],
      });
      if (session) {
        sessionExists = true;
        const { records: attRecords } = await BvAttendance.findAll({
          filters: { session: session.id },
          fields: ['id', 'user', 'present'],
          limit: 500,
        });
        attRecords.forEach((a: any) => {
          const uid = Array.isArray(a.user) ? a.user[0] : a.user;
          if (uid) attendanceMap[uid] = a.present ?? null;
        });
      }
    }

    const members = memberRecords
      .map((m: any) => {
        const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
        if (!dbId) return null;
        const u = userMap[dbId];
        if (!u) return null;
        return {
          userDbId: dbId,
          userId: u.userId || dbId,
          fullName: u.fullName || '',
          present: sessionExists ? (attendanceMap[dbId] ?? null) : null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));

    return {
      members,
      sessionExists,
      sessionId: null, // deprecated — use group+date directly
    };
  },
});
