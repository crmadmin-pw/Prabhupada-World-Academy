import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, BvQuizzes, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get full BV group detail — group info, active members, recent sessions',
  authenticated: true,
  inputSchema: z.object({ groupId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    if (!input.groupId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'groupId is required' });

    // Try finding by the custom groupId field first, then fall back to DB record ID
    let group = await BvGroups.findOne({
      filters: { groupId: input.groupId },
      fields: ['id', 'groupId', 'groupName', 'description', 'isActive', 'joinToken', 'whatsAppLink', 'bvslLeader'],
    });
    if (!group) {
      group = await BvGroups.findOne({
        id: input.groupId,
        fields: ['id', 'groupId', 'groupName', 'description', 'isActive', 'joinToken', 'whatsAppLink', 'bvslLeader'],
      }).catch(() => undefined);
    }
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    const [membersRes, sessionsRes, quizzesRes] = await Promise.all([
      BvGroupMembers.findAll({ filters: { group: group.id }, fields: ['id', 'user', 'role', 'joinedAt'], limit: 200 }),
      BvSessions.findAll({ filters: { group: group.id }, fields: ['id', 'sessionId', 'sessionDate', 'topic', 'notes'], limit: 50 }),
      BvQuizzes.findAll({ filters: { group: group.id }, fields: ['id', 'groupId', 'title', 'createdAt'], limit: 50 }),
    ]);

    const memberUserIds = membersRes.records
      .map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user)
      .filter(Boolean) as string[];

    const userRecords = memberUserIds.length > 0
      ? await Users.findAll({ filters: { id: { in: memberUserIds } }, fields: ['id', 'userId', 'fullName', 'phone', 'ashrayLevel'], limit: 500 })
      : { records: [] };

    const userMap: Record<string, any> = {};
    userRecords.records.forEach((u: any) => { userMap[u.id] = u; });

    const members = membersRes.records.map((m: any) => {
      const uid = Array.isArray(m.user) ? m.user[0] : m.user;
      const u = userMap[uid || ''] as any;
      return {
        membershipId: m.id,
        userId: u?.userId || uid || '',
        fullName: u?.fullName || '',
        phone: u?.phone || '',
        ashrayLevel: u?.ashrayLevel || null,
        role: (m.role as string) || 'Member',
        joinedAt: (m.joinedAt as string) || '',
      };
    });

    const sessions = sessionsRes.records.map((s: any) => ({
      sessionId: (s.sessionId as string) || s.id,
      sessionDate: ((s.sessionDate as string) || '').slice(0, 10),
      topic: (s.topic as string) || '',
      notes: (s.notes as string) || '',
    }));

    const quizzes = quizzesRes.records.map((q: any) => ({
      quizId: q.id,
      title: (q.title as string) || 'Untitled Quiz',
      createdAt: (q.createdAt as string) || '',
    }));

    return {
      group: {
        groupId: (group.groupId as string) || group.id,
        groupName: (group.groupName as string) || '',
        description: (group.description as string) || '',
        isActive: (group.isActive as boolean) ?? true,
        joinToken: (group.joinToken as string) || null,
        whatsAppLink: (group.whatsAppLink as string) || null,
      },
      members,
      recentSessions: sessions.sort((a: any, b: any) => b.sessionDate.localeCompare(a.sessionDate)).slice(0, 20),
      quizzes,
      totalSessions: sessions.length,
      totalQuizzes: quizzes.length,
    };
  },
});
