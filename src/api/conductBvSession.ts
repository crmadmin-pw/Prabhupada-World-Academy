import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, AppError } from '@/lib/backend-sdk';

export default createEndpoint({
  description: 'Save BV session attendance for a group and date. Idempotent — creates the session if needed, updates existing attendance. Also writes attendanceDate and group directly to attendance records.',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(),
    groupId: z.string(),
    sessionDate: z.string(),
    presentUserIds: z.array(z.string()).optional(), // DB UUIDs of users marked present
    totalMeetingMinutes: z.number().optional().default(60),
    memberAttendance: z.array(z.object({
      userDbId: z.string(),
      present: z.boolean(),
      attendedMinutes: z.number().optional(),
    })).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    // Resolve group — try custom groupId first, then DB UUID
    let group = await BvGroups.findOne({
      filters: { groupId: input.groupId },
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'rgsfId', 'subFacilitatorId'],
    });
    if (!group) {
      group = await BvGroups.findOne({
        id: input.groupId,
        fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'rgsfId', 'subFacilitatorId'],
      });
    }
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    // Attendance is authoritative only when saved by this group's assigned
    // facilitator. Do not allow a member (or another group's facilitator) to
    // submit attendance for the group through the endpoint directly.
    const callerIds = new Set([
      context.user?.id,
      context.user?.userId,
      context.user?.email,
    ].filter(Boolean).map((value: any) => String(value).toLowerCase()));
    const facilitatorIds = [
      ...(Array.isArray(group.bvslLeader) ? group.bvslLeader : [group.bvslLeader]),
      ...(Array.isArray(group.bvslId) ? group.bvslId : [group.bvslId]),
      ...(Array.isArray((group as any).rgsfId) ? (group as any).rgsfId : [(group as any).rgsfId]),
      ...(Array.isArray((group as any).subFacilitatorId) ? (group as any).subFacilitatorId : [(group as any).subFacilitatorId]),
    ].filter(Boolean).map(String);
    if (!facilitatorIds.some(id => callerIds.has(id.toLowerCase()))) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only this Reading Group\'s facilitator can save attendance' });
    }

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

    const totalMinutes = input.totalMeetingMinutes || 60;
    const memberAttMap: Record<string, { present: boolean; attendedMinutes: number }> = {};

    if (input.memberAttendance && input.memberAttendance.length > 0) {
      input.memberAttendance.forEach((ma: any) => {
        memberAttMap[ma.userDbId] = {
          present: !!ma.present,
          attendedMinutes: typeof ma.attendedMinutes === 'number' ? ma.attendedMinutes : (ma.present ? totalMinutes : 0),
        };
      });
    } else {
      const presentSet = new Set(input.presentUserIds || []);
      validMembers.forEach((m: any) => {
        const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
        const isPresent = presentSet.has(dbId);
        memberAttMap[dbId] = {
          present: isPresent,
          attendedMinutes: isPresent ? totalMinutes : 0,
        };
      });
    }

    // Split into records to update vs records to create
    const toUpdate: { id: string; present: boolean; attendedMinutes: number; totalMeetingMinutes: number }[] = [];
    const toCreate: { session: string; user: string; present: boolean; attendedMinutes: number; totalMeetingMinutes: number; attendanceDate: string; group: string }[] = [];

    for (const m of validMembers) {
      const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
      const attData = memberAttMap[dbId] || { present: false, attendedMinutes: 0 };
      if (attByUserDbId[dbId]) {
        toUpdate.push({
          id: attByUserDbId[dbId],
          present: attData.present,
          attendedMinutes: attData.attendedMinutes,
          totalMeetingMinutes: totalMinutes,
        });
      } else {
        toCreate.push({
          session: session.id,
          user: dbId,
          present: attData.present,
          attendedMinutes: attData.attendedMinutes,
          totalMeetingMinutes: totalMinutes,
          attendanceDate: input.sessionDate,
          group: group.id,
        });
      }
    }

    // Update existing attendance records
    await Promise.all(toUpdate.map(u => BvAttendance.update({
      id: u.id,
      record: { present: u.present, attendedMinutes: u.attendedMinutes, totalMeetingMinutes: u.totalMeetingMinutes },
    })));

    // Bulk create new attendance records (chunks of 100)
    for (let i = 0; i < toCreate.length; i += 100) {
      await BvAttendance.bulkCreate({ records: toCreate.slice(i, i + 100) });
    }

    const presentCount = Object.values(memberAttMap).filter(v => v.present).length;

    return {
      success: true,
      sessionId: session.id,
      message: `Attendance saved for ${group.groupName} — ${presentCount}/${validMembers.length} present (${totalMinutes} mins session)`,
    };
  },
});
