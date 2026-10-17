import { z } from 'zod';
import { createEndpoint, BvAttendance, BvSessions, AppError } from '@/lib/backend-sdk';
import { bvUserAliases, isBvDepartmentAdmin, resolveBvDepartmentGroups, resolveBvUsersByAliases } from '@/lib/bvGroupMemberScope';
import { readGroupFacilitators, textList } from '@/lib/bvGroupFacilitators';
import { getTodayIST } from '@/lib/streakUtils';

const EXPECTED_VISITS = 2;
const USER_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'email', 'status', 'firebaseUid', 'uid', 'authUid', 'bvReportingSupervisorId', 'bvReportingSupervisorName'];

function isoWeekStart(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function identityKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identityKeys);
  const text = String(value ?? '').trim().toLowerCase();
  return text ? [text] : [];
}

type SupervisorPerson = {
  userDbId: string;
  fullName: string;
  aliases: Set<string>;
};

function peopleFrom(users: any[], fallbackName = ''): SupervisorPerson[] {
  const people: SupervisorPerson[] = [];
  const seen = new Set<string>();
  for (const user of users) {
    if (!user || (user.status && String(user.status).toLowerCase() !== 'active')) continue;
    const userDbId = String(user.id || '').trim();
    if (!userDbId || seen.has(userDbId)) continue;
    seen.add(userDbId);
    people.push({
      userDbId,
      fullName: String(user.fullName || user.displayName || user.name || 'Supervisor').trim(),
      aliases: new Set(bvUserAliases(user)),
    });
  }
  if (people.length === 0 && fallbackName) {
    return [{ userDbId: '', fullName: fallbackName, aliases: new Set([fallbackName.toLowerCase()]) }];
  }
  return people;
}

function indexUsers(users: any[]): Map<string, any> {
  const byAlias = new Map<string, any>();
  for (const user of users) {
    if (user?.status && String(user.status).toLowerCase() !== 'active') continue;
    for (const alias of bvUserAliases(user)) byAlias.set(alias, user);
  }
  return byAlias;
}

/** One directory read for every group, instead of a user scan per group. */
async function supervisorsByGroup(groups: Array<{ id: string; record: any }>): Promise<Map<string, SupervisorPerson[]>> {
  const result = new Map<string, SupervisorPerson[]>();
  const directAliases = new Set<string>();
  const needsFacilitator: Array<{ id: string; record: any }> = [];
  for (const group of groups) {
    const aliases = textList([group.record.supervisorId, group.record.supervisorUserId]).map(value => value.toLowerCase());
    if (aliases.length === 0) needsFacilitator.push(group);
    else aliases.forEach(alias => directAliases.add(alias));
  }
  const directUsers = directAliases.size > 0 ? await resolveBvUsersByAliases([...directAliases], USER_FIELDS) : [];
  const byAlias = indexUsers(directUsers);

  const assignDirect = (group: { id: string; record: any }) => {
    const aliases = textList([group.record.supervisorId, group.record.supervisorUserId]).map(value => value.toLowerCase());
    const matched = aliases.map(alias => byAlias.get(alias)).filter(Boolean);
    result.set(group.id, peopleFrom(matched, String(group.record.supervisorName || '').trim()));
  };
  for (const group of groups) {
    if (!needsFacilitator.includes(group)) assignDirect(group);
  }

  if (needsFacilitator.length > 0) {
    const facilitatorAliases = [...new Set(needsFacilitator.flatMap(group =>
      readGroupFacilitators(group.record).flatMap(person => [person.id, person.userId].map(value => String(value || '').trim().toLowerCase()).filter(Boolean)),
    ))];
    const facilitators = facilitatorAliases.length > 0 ? await resolveBvUsersByAliases(facilitatorAliases, USER_FIELDS) : [];
    const facilitatorByAlias = indexUsers(facilitators);
    const supervisorAliases = new Set<string>();
    for (const user of facilitators) textList(user.bvReportingSupervisorId).forEach(value => supervisorAliases.add(value.toLowerCase()));
    const extra = supervisorAliases.size > 0 ? await resolveBvUsersByAliases([...supervisorAliases], USER_FIELDS) : [];
    for (const [alias, user] of indexUsers(extra)) byAlias.set(alias, user);

    for (const group of needsFacilitator) {
      const reporting = readGroupFacilitators(group.record).flatMap(person => {
        const match = [person.id, person.userId]
          .map(value => facilitatorByAlias.get(String(value || '').trim().toLowerCase()))
          .find(Boolean);
        return match ? [match] : [];
      });
      const aliases = [...new Set(reporting.flatMap(user => textList(user.bvReportingSupervisorId).map(value => value.toLowerCase())))];
      const storedName = String(
        group.record.supervisorName || reporting.map(user => user.bvReportingSupervisorName).find(Boolean) || '',
      ).trim();
      result.set(group.id, peopleFrom(aliases.map(alias => byAlias.get(alias)).filter(Boolean), storedName));
    }
  }
  return result;
}

async function readPaged(
  table: { findAll: (query: any) => Promise<{ records: any[]; hasMore: boolean }> },
  filters: Record<string, unknown>,
  fields: string[],
) {
  const records: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const result = await table.findAll({ filters, fields, limit: 500, offset: page * 500 });
    records.push(...(result.records || []));
    if (!result.hasMore || (result.records || []).length === 0) break;
  }
  return records;
}

export default createEndpoint({
  description: 'Reading-group supervisor visit report for admins. Lists every group, and for one group shows whether its supervisor joined each session.',
  authenticated: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK']),
    groupId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!isBvDepartmentAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only an admin can view the supervisor report' });
    }

    const groups = await resolveBvDepartmentGroups(input.segment, undefined, { includeInactive: false });
    const supervisorMap = await supervisorsByGroup(groups);
    const listed = groups.map(group => {
      const supervisors = supervisorMap.get(group.id) || [];
      return {
        id: group.id,
        groupId: group.groupId,
        groupName: group.groupName,
        supervisorNames: supervisors.map(person => person.fullName).filter(Boolean),
      };
    }).sort((a, b) => a.groupName.localeCompare(b.groupName));

    if (!input.groupId) return { groups: listed, report: null };

    const selected = groups.find(group => group.id === input.groupId || group.groupId === input.groupId);
    if (!selected) throw new AppError({ code: 'NOT_FOUND', message: 'Reading group not found' });
    const supervisors = (supervisorMap.get(selected.id) || []).filter(person => person.userDbId || person.fullName);

    const groupKeys = [...new Set([selected.id, selected.groupId].filter(Boolean))];
    const [attendancePages, sessionPages] = await Promise.all([
      Promise.all(groupKeys.map(key => readPaged(BvAttendance, { group: key }, ['id', 'user', 'present', 'attendedMinutes', 'totalMeetingMinutes', 'attendanceDate']))),
      Promise.all(groupKeys.map(key => readPaged(BvSessions, { group: key }, ['id', 'sessionDate']))),
    ]);
    const attendance = [...new Map(attendancePages.flat().map(row => [row.id, row])).values()];
    const sessions = [...new Map(sessionPages.flat().map(row => [row.id, row])).values()];

    const days = new Map<string, { totalMinutes: number; visits: Map<string, number> }>();
    const dayFor = (date: string) => {
      const existing = days.get(date);
      if (existing) return existing;
      const created = { totalMinutes: 0, visits: new Map<string, number>() };
      days.set(date, created);
      return created;
    };
    for (const session of sessions) {
      const date = dateKey(session.sessionDate);
      if (date) dayFor(date);
    }
    for (const row of attendance) {
      const date = dateKey(row.attendanceDate);
      if (!date) continue;
      const day = dayFor(date);
      const total = typeof row.totalMeetingMinutes === 'number' ? row.totalMeetingMinutes : 0;
      if (total > day.totalMinutes) day.totalMinutes = total;
      const keys = identityKeys(row.user);
      for (const supervisor of supervisors) {
        if (!supervisor.userDbId || !keys.some(key => supervisor.aliases.has(key))) continue;
        const minutes = typeof row.attendedMinutes === 'number'
          ? row.attendedMinutes
          : (row.present ? total || 60 : 0);
        day.visits.set(supervisor.userDbId, Math.max(day.visits.get(supervisor.userDbId) || 0, minutes));
      }
    }

    const currentWeek = isoWeekStart(getTodayIST());
    const sessionWeeks = [...days.keys()].map(isoWeekStart).filter(Boolean);
    const firstWeek = sessionWeeks.length > 0
      ? sessionWeeks.reduce((earliest, week) => week < earliest ? week : earliest)
      : currentWeek;
    const weeks = [];
    for (let weekStart = currentWeek; weekStart && firstWeek && weekStart >= firstWeek; weekStart = addDays(weekStart, -7)) {
      const weekEnd = addDays(weekStart, 6);
      const weekSessions = [...days.keys()]
        .filter(date => date >= weekStart && date <= weekEnd)
        .sort()
        .map(date => {
          const day = days.get(date)!;
          const totalMinutes = day.totalMinutes > 0 ? day.totalMinutes : 60;
          return {
            date,
            totalMinutes,
            supervisors: supervisors.filter(person => person.userDbId).map(person => {
              const attendedMinutes = Math.min(day.visits.get(person.userDbId) || 0, totalMinutes);
              return {
                userDbId: person.userDbId,
                fullName: person.fullName,
                attendedMinutes,
                joined: attendedMinutes > 0,
              };
            }),
          };
        });
      weeks.push({
        weekStart,
        weekEnd,
        current: weekStart === currentWeek,
        sessions: weekSessions,
        supervisors: supervisors.filter(person => person.userDbId).map(person => {
          const visits = weekSessions.filter(session =>
            session.supervisors.some(visit => visit.userDbId === person.userDbId && visit.joined),
          ).length;
          const status = weekSessions.length === 0
            ? 'no_session'
            : visits >= EXPECTED_VISITS
              ? 'met'
              : weekStart === currentWeek
                ? 'in_progress'
                : 'short';
          return {
            userDbId: person.userDbId,
            fullName: person.fullName,
            visits,
            expectedVisits: EXPECTED_VISITS,
            status,
          };
        }),
      });
    }

    return {
      groups: listed,
      report: {
        id: selected.id,
        groupId: selected.groupId,
        groupName: selected.groupName,
        expectedVisits: EXPECTED_VISITS,
        supervisors: supervisors.map(person => ({ userDbId: person.userDbId, fullName: person.fullName })),
        weeks,
      },
    };
  },
});
