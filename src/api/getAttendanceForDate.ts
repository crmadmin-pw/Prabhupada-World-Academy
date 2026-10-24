import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvSessions, BvAttendance, Users, AppError } from '@/lib/backend-sdk';
import { findAttendanceGroup } from '@/lib/bvAttendanceAccess';
import { bvUserAliases, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { countsAsGroupMember, facilitatorRoleLabel, loadGroupFacilitators, loadGroupSupervisors } from '@/lib/bvGroupFacilitators';

const GROUP_FIELDS = [
  'id', 'groupId', 'groupName',
  'bvslLeader', 'bvslId', 'bvslName',
  'rgsfId', 'subFacilitatorId', 'subFacilitator',
  'supervisorId', 'supervisorUserId', 'supervisorName',
];

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
  execute: async ({ input, context }) => {
    const group = await findAttendanceGroup(input.groupId, GROUP_FIELDS);
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });

    await resolveBvScopedGroups({ ...context.user }, { groupId: group.id });

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
    const userFields = ['id', 'userId', 'fullName', 'email', 'firebaseUid', 'uid', 'authUid', 'status', 'role', 'isBvMember', 'bvGroupId', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator'];
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

    const rememberAttendance = (uid: unknown, present: boolean | null, minutes: number | null) => {
      const key = String(uid || '').trim();
      if (!key) return;
      attendanceMap[key] = present;
      attendanceMap[key.toLowerCase()] = present;
      attendedMinutesMap[key] = minutes;
      attendedMinutesMap[key.toLowerCase()] = minutes;
    };

    if (directAttRecords.length > 0) {
      directAttRecords.forEach((a: any) => {
        const uid = Array.isArray(a.user) ? a.user[0] : a.user;
        if (uid) {
          const minutes = typeof a.attendedMinutes === 'number' ? a.attendedMinutes : (a.present ? (a.totalMeetingMinutes || 60) : 0);
          rememberAttendance(uid, a.present ?? null, minutes);
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
            const minutes = typeof a.attendedMinutes === 'number' ? a.attendedMinutes : (a.present ? (a.totalMeetingMinutes || 60) : 0);
            rememberAttendance(uid, a.present ?? null, minutes);
          }
          if (a.totalMeetingMinutes && typeof a.totalMeetingMinutes === 'number') {
            totalMeetingMinutes = a.totalMeetingMinutes;
          }
        });
      }
    }

    const staff = await loadGroupFacilitators(group);
    const supervisors = await loadGroupSupervisors(group);
    const supervisorAliasSets = supervisors.map(user => new Set(bvUserAliases(user)));
    const isSupervisor = (user: any) => {
      const aliases = bvUserAliases(user);
      return supervisorAliasSets.some(keys => aliases.some(alias => keys.has(alias)));
    };
    const roleFor = (user: any): 'RGF' | 'RGSF' | null => {
      if (!user) return null;
      const aliases = new Set(bvUserAliases(user));
      let role: 'RGF' | 'RGSF' | null = null;
      for (const entry of staff) {
        if (!bvUserAliases(entry.user).some(alias => aliases.has(alias))) continue;
        const label = facilitatorRoleLabel(entry.badges);
        if (label === 'RGF') return 'RGF';
        if (label) role = label;
      }
      return role;
    };
    const savedFor = (user: any, extraIds: string[]) => {
      const keys = [...extraIds, ...bvUserAliases(user)].map(value => String(value || '').trim()).filter(Boolean);
      let present: boolean | null | undefined;
      let minutes: number | null | undefined;
      for (const key of keys) {
        if (present === undefined && attendanceMap[key] !== undefined) present = attendanceMap[key];
        if (minutes === undefined && attendedMinutesMap[key] !== undefined) minutes = attendedMinutesMap[key];
      }
      return { present: present ?? null, minutes };
    };

    const members = memberRecords
      .map((m: any) => {
        const dbId = Array.isArray(m.user) ? m.user[0] : m.user as string;
        const u = refs([m.user, m.userId, m.memberId]).map(alias => userMap[alias]).find(Boolean);
        if (!u) return null;
        const saved = savedFor(u, [u.id, dbId]);
        const isPresent = sessionExists ? saved.present : null;
        if (!countsAsGroupMember(u, group)) return null;
        return {
          userDbId: u.id,
          userId: u.userId || u.id,
          fullName: u.fullName || '',
          present: isPresent,
          attendedMinutes: sessionExists ? (saved.minutes ?? (isPresent ? totalMeetingMinutes : 0)) : 0,
          roleLabel: roleFor(u),
          supervisor: isSupervisor(u),
        };
      })
      .filter(member => member !== null);

    const covered = new Set(members.flatMap(member => bvUserAliases({ id: member.userDbId, userId: member.userId })));
    for (const entry of staff) {
      const aliases = bvUserAliases(entry.user);
      if (aliases.some(alias => covered.has(alias))) continue;
      const saved = savedFor(entry.user, []);
      const isPresent = sessionExists ? saved.present : null;
      members.push({
        userDbId: entry.user.id,
        userId: entry.user.userId || entry.user.id,
        fullName: entry.user.fullName || '',
        present: isPresent,
        attendedMinutes: sessionExists ? (saved.minutes ?? (isPresent ? totalMeetingMinutes : 0)) : 0,
        roleLabel: facilitatorRoleLabel(entry.badges),
        supervisor: isSupervisor(entry.user),
      });
      aliases.forEach(alias => covered.add(alias));
    }
    for (const supervisor of supervisors) {
      const aliases = bvUserAliases(supervisor);
      const alreadyListed = members.find((member: any) =>
        aliases.includes(String(member.userDbId || '').trim().toLowerCase())
        || aliases.includes(String(member.userId || '').trim().toLowerCase()),
      );
      if (alreadyListed) {
        alreadyListed.supervisor = true;
        continue;
      }
      if (aliases.some(alias => covered.has(alias))) continue;
      const saved = savedFor(supervisor, []);
      const isPresent = sessionExists ? saved.present : null;
      members.push({
        userDbId: supervisor.id,
        userId: supervisor.userId || supervisor.id,
        fullName: supervisor.fullName || '',
        present: isPresent,
        attendedMinutes: sessionExists ? (saved.minutes ?? (isPresent ? totalMeetingMinutes : 0)) : 0,
        roleLabel: null,
        supervisor: true,
      });
      aliases.forEach(alias => covered.add(alias));
    }

    const roleRank = (member: any) => (member.roleLabel === 'RGF' ? 0 : member.roleLabel === 'RGSF' ? 1 : member.supervisor ? 2 : 3);
    members.sort((a: any, b: any) => roleRank(a) - roleRank(b) || a.fullName.localeCompare(b.fullName));

    return {
      members,
      sessionExists,
      totalMeetingMinutes,
      sessionId: null, // deprecated — use group+date directly
    };
  },
});
