import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, Users, AppError } from '@/lib/backend-sdk';
import { bvUserAliases } from '../lib/bvGroupMemberScope';

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  return value == null ? [] : [String(value).trim().toLowerCase()].filter(Boolean);
}

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
      });
    }
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    const groupKeys = [group.id, group.groupId].filter(Boolean);
    const [byGroup, byGroupId] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { group: group.id },
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
        limit: 200,
      }),
      BvGroupMembers.findAll({
        filters: { groupId: { in: groupKeys } } as any,
        fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
        limit: 200,
      }),
    ]);
    const memberRecords = [...byGroup.records, ...byGroupId.records]
      .filter((member: any, index: number, records: any[]) => records.findIndex(item => item.id === member.id) === index);

    const identityValues = [...new Set(memberRecords.flatMap((member: any) => [member.user, member.userId, member.memberId]).filter(Boolean).map(String))];
    const userFields = ['id', 'userId', 'fullName', 'firebaseUid', 'uid', 'authUid'];
    const userQueries = identityValues.length > 0
      ? await Promise.all([
        Users.findAll({ filters: { id: { in: identityValues } } as any, fields: userFields, limit: 500 }),
        Users.findAll({ filters: { userId: { in: identityValues } } as any, fields: userFields, limit: 500 }),
        Users.findAll({ filters: { firebaseUid: { in: identityValues } } as any, fields: userFields, limit: 500 }),
      ])
      : [];
    const userMap: Record<string, any> = {};
    userQueries.flatMap(result => result.records || []).forEach((user: any) => {
      bvUserAliases(user).forEach(alias => { userMap[alias] = user; });
    });

    // Query attendance directly by group + date (new approach)
    const { records: directAttRecords } = await BvAttendance.findAll({
      filters: { group: group.id, attendanceDate: input.date },
      fields: ['id', 'user', 'present', 'attendedMinutes', 'totalMeetingMinutes'],
      limit: 500,
    });

    const attendanceMap: Record<string, boolean | null> = {};
    const attendedMinutesMap: Record<string, number | null> = {};
    let totalMeetingMinutes: number = 60;
    let sessionExists = directAttRecords.length > 0;

    if (directAttRecords.length > 0) {
      directAttRecords.forEach((a: any) => {
        const uid = Array.isArray(a.user) ? a.user[0] : a.user;
        if (uid) {
          attendanceMap[uid] = a.present ?? null;
          attendedMinutesMap[uid] = typeof a.attendedMinutes === 'number' ? a.attendedMinutes : (a.present ? (a.totalMeetingMinutes || 60) : 0);
        }
        if (a.totalMeetingMinutes && typeof a.totalMeetingMinutes === 'number') {
          totalMeetingMinutes = a.totalMeetingMinutes;
        }
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
          fields: ['id', 'user', 'present', 'attendedMinutes', 'totalMeetingMinutes'],
          limit: 500,
        });
        attRecords.forEach((a: any) => {
          const uid = Array.isArray(a.user) ? a.user[0] : a.user;
          if (uid) {
            attendanceMap[uid] = a.present ?? null;
            attendedMinutesMap[uid] = typeof a.attendedMinutes === 'number' ? a.attendedMinutes : (a.present ? (a.totalMeetingMinutes || 60) : 0);
          }
          if (a.totalMeetingMinutes && typeof a.totalMeetingMinutes === 'number') {
            totalMeetingMinutes = a.totalMeetingMinutes;
          }
        });
      }
    }

    const members = memberRecords
      .map((m: any) => {
        const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
        const u = refs([m.user, m.userId, m.memberId]).map(alias => userMap[alias]).find(Boolean);
        if (!u) return null;
        const isPresent = sessionExists ? (attendanceMap[u.id] ?? attendanceMap[dbId] ?? null) : null;
        const savedMinutes = attendedMinutesMap[u.id] ?? attendedMinutesMap[dbId];
        return {
          userDbId: u.id,
          userId: u.userId || u.id,
          fullName: u.fullName || '',
          present: isPresent,
          attendedMinutes: sessionExists ? (savedMinutes ?? (isPresent ? totalMeetingMinutes : 0)) : 0,
        };
      })
      .filter(member => member !== null)
      .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));

    return {
      members,
      sessionExists,
      totalMeetingMinutes,
      sessionId: null, // deprecated — use group+date directly
    };
  },
});
