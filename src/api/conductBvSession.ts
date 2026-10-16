import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvSessions, BvAttendance, AppError } from '@/lib/backend-sdk';
import { callerFacilitatesReadingGroup } from '@/lib/bvAttendanceAccess';
import { bvUserAliases } from '@/lib/bvGroupMemberScope';
import { loadGroupFacilitators } from '@/lib/bvGroupFacilitators';

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
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'rgsfId', 'subFacilitatorId', 'subFacilitator'],
    });
    if (!group) {
      group = await BvGroups.findOne({
        id: input.groupId,
        fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'rgsfId', 'subFacilitatorId', 'subFacilitator'],
      });
    }
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    // Every RGF assigned to this group can save attendance. A second RGF is
    // stored beside the first, and her sign-in id may differ from the id
    // written on the group.
    if (!(await callerFacilitatesReadingGroup(group, context.user))) {
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
    const staff = await loadGroupFacilitators(group);
    const roster: Array<{ writeUserId: string; keys: string[] }> = [];
    const covered = new Set<string>();
    const addPerson = (writeUserId: string, keys: string[]) => {
      const id = String(writeUserId || '').trim();
      if (!id || covered.has(id.toLowerCase())) return;
      const uniqueKeys = [...new Set([id, ...keys].map(key => String(key || '').trim()).filter(Boolean))];
      roster.push({ writeUserId: id, keys: uniqueKeys });
      uniqueKeys.forEach(key => covered.add(key.toLowerCase()));
    };
    for (const member of validMembers) {
      const dbId = Array.isArray(member.user) ? member.user[0] : member.user as string;
      addPerson(dbId, [dbId]);
    }
    for (const entry of staff) {
      const aliases = bvUserAliases(entry.user);
      if (aliases.some(alias => covered.has(alias))) {
        const person = roster.find(item => item.keys.some(key => aliases.includes(key.toLowerCase())));
        if (person) {
          for (const alias of [entry.user.id, entry.user.userId, ...aliases]) {
            const key = String(alias || '').trim();
            if (!key || person.keys.some(existing => existing.toLowerCase() === key.toLowerCase())) continue;
            person.keys.push(key);
            covered.add(key.toLowerCase());
          }
        }
        continue;
      }
      addPerson(entry.user.id, [entry.user.id, entry.user.userId, ...aliases]);
    }

    // Load existing attendance records for this group+date (new approach)
    const { records: existingAtt } = await BvAttendance.findAll({
      filters: { group: group.id, attendanceDate: input.sessionDate },
      fields: ['id', 'user'],
      limit: 500,
    });
    const attByUserDbId: Record<string, string> = {};
    existingAtt.forEach((a: any) => {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user as string;
      if (!uid) return;
      attByUserDbId[uid] = a.id;
      attByUserDbId[String(uid).toLowerCase()] = a.id;
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
      const presentSet = new Set((input.presentUserIds || []).map((id: string) => String(id).toLowerCase()));
      for (const person of roster) {
        const isPresent = person.keys.some(key => presentSet.has(key.toLowerCase()));
        memberAttMap[person.writeUserId] = {
          present: isPresent,
          attendedMinutes: isPresent ? totalMinutes : 0,
        };
      }
    }

    const payloadFor = (keys: string[]) => {
      for (const key of keys) {
        if (memberAttMap[key]) return memberAttMap[key];
      }
      const lower = new Map(Object.entries(memberAttMap).map(([key, value]) => [key.toLowerCase(), value]));
      for (const key of keys) {
        const hit = lower.get(key.toLowerCase());
        if (hit) return hit;
      }
      return { present: false, attendedMinutes: 0 };
    };
    const existingIdFor = (keys: string[]) => {
      for (const key of keys) {
        if (attByUserDbId[key]) return attByUserDbId[key];
        if (attByUserDbId[key.toLowerCase()]) return attByUserDbId[key.toLowerCase()];
      }
      return undefined;
    };

    // Split into records to update vs records to create
    const toUpdate: { id: string; present: boolean; attendedMinutes: number; totalMeetingMinutes: number }[] = [];
    const toCreate: { session: string; user: string; present: boolean; attendedMinutes: number; totalMeetingMinutes: number; attendanceDate: string; group: string }[] = [];

    for (const person of roster) {
      const attData = payloadFor(person.keys);
      const existingId = existingIdFor(person.keys);
      if (existingId) {
        toUpdate.push({
          id: existingId,
          present: attData.present,
          attendedMinutes: attData.attendedMinutes,
          totalMeetingMinutes: totalMinutes,
        });
      } else {
        toCreate.push({
          session: session.id,
          user: person.writeUserId,
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

    const presentCount = roster.filter(person => payloadFor(person.keys).present).length;

    return {
      success: true,
      sessionId: session.id,
      message: `Attendance saved for ${group.groupName} — ${presentCount}/${roster.length} present (${totalMinutes} mins session)`,
    };
  },
});
