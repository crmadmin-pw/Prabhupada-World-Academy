import { z } from 'zod';
import { createEndpoint, BvGroups, BvSessions, BvAttendance, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';

const referenceValues = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(Boolean).map(String);

const normalizedValues = (value: unknown): string[] =>
  referenceValues(value).map(item => item.trim().toLowerCase()).filter(Boolean);

async function requireAssignedFacilitator(groupId: string, context: any) {
  const group = await BvGroups.findOne({
    id: groupId,
    fields: ['id', 'bvslLeader', 'bvslId', 'rgsfId', 'subFacilitatorId', 'subFacilitator'],
  });
  if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Reading Group not found' });

  const callerIds = new Set([
    context.user?.id,
    context.user?.userId,
    context.user?.email,
  ].filter(Boolean).map((value: any) => String(value).toLowerCase()));
  const facilitatorIds = [
    ...referenceValues(group.bvslLeader),
    ...referenceValues(group.bvslId),
    ...referenceValues(group.rgsfId),
    ...referenceValues(group.subFacilitatorId),
    ...referenceValues(group.subFacilitator),
  ];

  if (!facilitatorIds.some(id => callerIds.has(id.toLowerCase()))) {
    throw new AppError({ code: 'FORBIDDEN', message: 'Only this Reading Group\'s facilitator can mark attendance' });
  }
  return group;
}

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

    // Resolve canonical user keys (document ID, custom user ID, email). The
    // attendance writer must use the same identity as group-session attendance
    // rather than treating the custom userId as a separate member.
    const targetUserId = input.userId || context.user!.id;
    const [byId, byUserId, byEmail] = await Promise.all([
      Users.findOne({ id: targetUserId, fields: ['id', 'userId', 'email'] }),
      Users.findOne({ filters: { userId: targetUserId }, fields: ['id', 'userId', 'email'] }),
      Users.findOne({ filters: { email: targetUserId }, fields: ['id', 'userId', 'email'] }),
    ]);
    const targetUser = byId || byUserId || byEmail;
    const uid = targetUser?.id || targetUserId;
    const userKeys = new Set<string>(normalizedValues([
      targetUserId,
      targetUser?.id,
      targetUser?.userId,
      targetUser?.email,
    ]));

    // If sessionId is given, mark attendance for that session
    if (input.sessionId) {
      const session = await BvSessions.findOne({
        id: input.sessionId,
        fields: ['id', 'sessionDate', 'group'],
      });
      if (!session) throw new AppError({ code: 'NOT_FOUND', message: 'Session not found' });

      const sessionDate = String(session.sessionDate || '').slice(0, 10);
      const groupId = Array.isArray(session.group) ? session.group[0] : session.group as string | undefined;
      if (!groupId) throw new AppError({ code: 'BAD_REQUEST', message: 'Session is not linked to a Reading Group' });
      await requireAssignedFacilitator(groupId, context);

      const { records: dateRecords } = await BvAttendance.findAll({
        filters: { attendanceDate: sessionDate },
        limit: 1000,
      });

      const existing = dateRecords.find((a: any) => {
        const u = Array.isArray(a.user) ? a.user[0] : a.user;
        const recordGroup = Array.isArray(a.group) ? a.group[0] : (a.group || a.groupId);
        return userKeys.has(String(u || '').toLowerCase()) && (!recordGroup || String(recordGroup) === groupId);
      });

      if (existing) {
        await BvAttendance.update({ id: existing.id, record: { present: isPresent, group: groupId, session: input.sessionId } });
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
      // Resolve the target user's group before permitting a mark. A regular
      // member cannot mark their own attendance merely by calling this API.
      const aliases = [...userKeys];
      const [membershipByUser, membershipByUserId] = await Promise.all([
        BvGroupMembers.findAll({ filters: { user: { in: aliases } }, limit: 5, fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'] }),
        BvGroupMembers.findAll({ filters: { userId: { in: aliases } }, limit: 5, fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'] }),
      ]);
      let membership = membershipByUser.records[0] || membershipByUserId.records[0];
      if (!membership) {
        const { records } = await BvGroupMembers.findAll({
          fields: ['id', 'group', 'groupId', 'user', 'userId', 'memberId'],
          limit: 5000,
        });
        membership = records.find((member: any) => normalizedValues([
          member.id, member.user, member.userId, member.memberId,
        ]).some(value => userKeys.has(value)));
      }
      for (const alias of normalizedValues([
        membership?.id, membership?.user, membership?.userId, membership?.memberId,
      ])) userKeys.add(alias);
      const storedGroupId = membership
        ? (Array.isArray(membership.group) ? membership.group[0] : (membership.group || membership.groupId) as string)
        : null;
      const group = storedGroupId
        ? await BvGroups.findOne({ id: storedGroupId, fields: ['id', 'groupId'] })
          || await BvGroups.findOne({ filters: { groupId: storedGroupId }, fields: ['id', 'groupId'] })
        : null;
      const groupId = group?.id || storedGroupId;
      if (!groupId) throw new AppError({ code: 'NOT_FOUND', message: 'User is not assigned to a Reading Group' });
      await requireAssignedFacilitator(groupId, context);

      // Find all BvAttendance records for this date
      const { records: dateRecords } = await BvAttendance.findAll({
        filters: { attendanceDate: input.localDate },
        limit: 1000,
      });

      const existing = dateRecords.find((a: any) => {
        const u = Array.isArray(a.user) ? a.user[0] : a.user;
        const recordGroup = Array.isArray(a.group) ? a.group[0] : (a.group || a.groupId);
        return userKeys.has(String(u || '').toLowerCase()) && (!recordGroup || String(recordGroup) === groupId);
      });

      if (existing) {
        await BvAttendance.update({ id: existing.id, record: { present: isPresent, group: groupId } });
        return { success: true };
      }

      const session = groupId
        ? await BvSessions.findOne({ filters: { group: groupId, sessionDate: input.localDate }, fields: ['id'] })
        : null;

      await BvAttendance.create({
        record: {
          user: uid,
          present: isPresent,
          attendanceDate: input.localDate,
          ...(groupId ? { group: groupId } : {}),
          ...(session ? { session: session.id } : {}),
        },
      });
      return { success: true };
    }

    throw new AppError({ code: 'BAD_REQUEST', message: 'sessionId or localDate is required' });
  },
});
