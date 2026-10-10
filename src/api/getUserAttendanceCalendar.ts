import { z } from 'zod';
import { scopeRealtimeDependencies } from '@/lib/requestQueries';
import { createEndpoint, AttendanceRecords, AttendanceSessions, AttendanceEvents, BvAttendance, BvGroupMembers, Users } from '@/lib/backend-sdk';

const USER_IDENTITY_FIELDS = [
  'id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
  'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId',
];

function identityValues(user: any): string[] {
  return [...new Set(USER_IDENTITY_FIELDS
    .map(field => user?.[field])
    .filter(Boolean)
    .map(value => String(value).trim())
    .filter(Boolean))];
}

async function resolveUserProfile(contextUser: any) {
  const aliases = identityValues(contextUser);
  if (aliases.length === 0) return null;

  // Authentication commonly supplies a Firebase Auth UID while BV attendance
  // stores the Users document ID. Look through every supported identity field
  // so the calendar can compare those two representations of the same member.
  const lookups = USER_IDENTITY_FIELDS.map(field => Users.findAll({
    filters: { [field]: { in: aliases } },
    fields: USER_IDENTITY_FIELDS,
    limit: 30,
  }));
  const results = await Promise.all(lookups);
  return results.flatMap(result => result.records)[0] || null;
}

export default createEndpoint({
  description: 'Get attendance calendar data for the current user',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {

    const userKeys = new Set<string>();
    if (context.user?.id) userKeys.add(String(context.user.id).toLowerCase());
    if (context.user?.userId) userKeys.add(String(context.user.userId).toLowerCase());
    if (context.user?.email) userKeys.add(String(context.user.email).toLowerCase());
    const profileRecord = await resolveUserProfile(context.user);
    for (const key of identityValues(profileRecord)) {
      userKeys.add(String(key).toLowerCase());
    }

    // Facilitators normally save the Users document ID, but older approved
    // memberships can carry a custom user ID, email, or membership ID. Keep
    // all of those aliases together before matching the attendance rows.
    const initialKeys = [...userKeys];
    const [membershipByUser, membershipByUserId] = await Promise.all([
      BvGroupMembers.findAll({
        filters: { user: { in: initialKeys } },
        fields: ['id', 'user', 'userId', 'memberId'],
        limit: 10,
      }),
      BvGroupMembers.findAll({
        filters: { userId: { in: initialKeys } },
        fields: ['id', 'user', 'userId', 'memberId'],
        limit: 10,
      }),
    ]);
    let memberships = [...membershipByUser.records, ...membershipByUserId.records];
    if (memberships.length === 0) {
      const { records } = await BvGroupMembers.findAll({
        fields: ['id', 'user', 'userId', 'memberId'],
        limit: 5000,
      });
      memberships = records.filter((member: any) => [member.id, member.user, member.userId, member.memberId]
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .some(value => userKeys.has(String(value).trim().toLowerCase())));
    }
    for (const membership of memberships) {
      for (const key of [membership.id, membership.user, membership.userId, membership.memberId]
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter(Boolean)) {
        userKeys.add(String(key).trim().toLowerCase());
      }
    }

    scopeRealtimeDependencies('BvAttendance', { kind: 'references', fields: ['user'], values: [...userKeys], firstArrayValue: true });
    scopeRealtimeDependencies('AttendanceRecords', { kind: 'references', fields: ['user'], values: [...userKeys], firstArrayValue: true });
    scopeRealtimeDependencies('BvGroupMembers', { kind: 'references', fields: ['id', 'user', 'userId', 'memberId'], values: initialKeys });

    // Fetch BvAttendance records for user
    const { records: allBv } = await BvAttendance.findAll({
      limit: 2000,
      fields: ['id', 'user', 'group', 'groupId', 'attendanceDate', 'present'],
    });

    const bvAtt = allBv.filter((a: any) => {
      const rawU = Array.isArray(a.user) ? a.user[0] : a.user;
      // Official BV attendance is always connected to the reading group by
      // the facilitator. Ignore old Sadhana-created rows, which had no group
      // and incorrectly displayed unmarked days as absences.
      const groupId = Array.isArray(a.group) ? a.group[0] : (a.group || a.groupId);
      return userKeys.has(String(rawU || '').toLowerCase()) && !!groupId;
    });



    // Fetch legacy AttendanceRecords
    const { records: allLegacy } = await AttendanceRecords.findAll({
      limit: 2000,
      fields: ['id', 'user', 'session', 'date'],
    });

    const records = allLegacy.filter((r: any) => {
      const rawU = Array.isArray(r.user) ? r.user[0] : r.user;
      return userKeys.has(String(rawU || '').toLowerCase());
    });

    // Get unique session IDs
    const sessionIds = [...new Set(records.map(r => Array.isArray(r.session) ? r.session[0] : r.session).filter(Boolean))] as string[];

    // Fetch session and event details
    const sessionMap = new Map<string, { name: string; eventId?: string }>();
    const eventIds = new Set<string>();

    if (sessionIds.length > 0) {
      for (let i = 0; i < sessionIds.length; i += 100) {
        const batch = sessionIds.slice(i, i + 100);
        const { records: sessions } = await AttendanceSessions.findAll({
          filters: { id: { in: batch } } as any,
          fields: ['id', 'name', 'event'],
          limit: 100,
        });
        sessions.forEach(s => {
          const eid = Array.isArray(s.event) ? s.event[0] : s.event;
          sessionMap.set(s.id, { name: s.name || '', eventId: eid });
          if (eid) eventIds.add(eid);
        });
      }
    }

    const eventMap = new Map<string, string>();
    if (eventIds.size > 0) {
      const { records: events } = await AttendanceEvents.findAll({
        filters: { id: { in: [...eventIds] } } as any,
        fields: ['id', 'title'],
        limit: 100,
      });
      events.forEach(e => eventMap.set(e.id, e.title || ''));
    }

    const entryMap = new Map<string, { date: string; present: boolean; status: 'P' | 'A'; sessionName: string; eventTitle: string }>();

    // Add BvAttendance records (present: true or false)
    bvAtt.forEach((a: any) => {
      if (a.attendanceDate) {
        const isPres = !!a.present;
        entryMap.set(a.attendanceDate, {
          date: a.attendanceDate,
          present: isPres,
          status: isPres ? 'P' : 'A',
          sessionName: 'Bhakti Vriksha Session',
          eventTitle: isPres ? 'Present' : 'Absent',
        });
      }
    });



    // Add legacy AttendanceRecords
    records.forEach(r => {
      if (r.date && !entryMap.has(r.date)) {
        const sid = (Array.isArray(r.session) ? r.session[0] : r.session) as string;
        const session = sessionMap.get(sid);
        entryMap.set(r.date, {
          date: r.date || '',
          present: true,
          status: 'P',
          sessionName: session?.name || 'Session',
          eventTitle: session?.eventId ? eventMap.get(session.eventId) || '' : 'Program Session',
        });
      }
    });

    const entries = Array.from(entryMap.values()).sort((a, b) => b.date.localeCompare(a.date));

    // Calculate stats — count dates where present === true
    const presentDates = new Set(entries.filter(e => e.present).map(e => e.date));
    const totalDaysAttended = presentDates.size;

    // Current streak
    const sortedDates = [...presentDates].sort().reverse();
    let currentStreak = 0;
    const today = new Date();
    const checkDate = new Date(today);
    checkDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const dateStr = checkDate.toISOString().slice(0, 10);
      if (sortedDates.includes(dateStr)) {
        currentStreak++;
      } else if (i > 0) {
        break; // Allow today to be missing (streak from yesterday)
      }
      checkDate.setDate(checkDate.getDate() - 1);
    }

    // This month count
    const thisMonth = today.toISOString().slice(0, 7);
    const thisMonthCount = [...presentDates].filter(d => d.startsWith(thisMonth)).length;

    // Longest streak
    const allDates = [...presentDates].sort();
    let longestStreak = 0;
    let streak = 0;
    for (let i = 0; i < allDates.length; i++) {
      if (i === 0) { streak = 1; }
      else {
        const prev = new Date(allDates[i - 1]);
        const curr = new Date(allDates[i]);
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        streak = diff === 1 ? streak + 1 : 1;
      }
      longestStreak = Math.max(longestStreak, streak);
    }

    return {
      entries,
      stats: { totalDaysAttended, currentStreak, thisMonthCount, longestStreak },
    };
  },
});
