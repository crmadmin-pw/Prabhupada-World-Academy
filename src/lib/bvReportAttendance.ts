function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

export type ReportAttendanceRecord = {
  user?: unknown;
  group?: unknown;
  groupId?: unknown;
  present?: unknown;
  status?: unknown;
  attendanceDate?: unknown;
};

/**
 * Keep former-group marks before a known transfer date. From the joining day,
 * a former-group presence must not override an absence, or an unmarked session,
 * in the current group. Legacy memberships without dates retain that rule.
 */
export function mergeReportAttendance(
  records: ReportAttendanceRecord[],
  memberGroupByUserId: Map<string, string>,
  userIdFor: (reference: string) => string,
  groupIdFor: (reference: string) => string,
  joinedOnByUserId = new Map<string, string>(),
): {
  attendance: Record<string, Record<string, boolean | 'L'>>;
  groupSessionDates: Map<string, Set<string>>;
  sessionDates: string[];
} {
  const groupSessionDates = new Map<string, Set<string>>();
  const sessionDates = new Set<string>();
  const current = new Map<string, boolean | 'L'>();
  const former = new Map<string, boolean | 'L'>();
  const combine = (previous: boolean | 'L' | undefined, mark: boolean | 'L') =>
    previous === 'L' || mark === 'L' ? 'L' as const : previous === true || mark === true;

  for (const record of records) {
    const reference = firstValue(record.user).trim();
    const uid = userIdFor(reference) || reference;
    const date = String(record.attendanceDate || '').slice(0, 10);
    const rawGroup = firstValue(record.group).trim() || firstValue(record.groupId).trim();
    const gid = (rawGroup && groupIdFor(rawGroup)) || rawGroup;
    if (!uid || !date) continue;
    sessionDates.add(date);
    if (gid) {
      if (!groupSessionDates.has(gid)) groupSessionDates.set(gid, new Set());
      groupSessionDates.get(gid)!.add(date);
    }
    const memberGroup = memberGroupByUserId.get(uid) || '';
    const inCurrentGroup = !memberGroup || !gid || gid === memberGroup;
    const key = `${uid}|${date}`;
    const mark = record.status === 'L' ? 'L' : !!record.present;
    if (inCurrentGroup) current.set(key, combine(current.get(key), mark));
    else former.set(key, combine(former.get(key), mark));
  }

  const attendance: Record<string, Record<string, boolean | 'L'>> = {};
  const write = (key: string, present: boolean | 'L') => {
    const split = key.indexOf('|');
    const uid = key.slice(0, split);
    const date = key.slice(split + 1);
    if (!attendance[uid]) attendance[uid] = {};
    attendance[uid][date] = present;
  };
  for (const [key, present] of former) {
    const split = key.indexOf('|');
    const uid = key.slice(0, split);
    const date = key.slice(split + 1);
    const memberGroup = memberGroupByUserId.get(uid) || '';
    const joinedOn = joinedOnByUserId.get(uid);
    if ((!joinedOn || date >= joinedOn) && memberGroup && groupSessionDates.get(memberGroup)?.has(date)) continue;
    write(key, present);
  }
  for (const [key, present] of current) {
    const split = key.indexOf('|');
    const uid = key.slice(0, split);
    const date = key.slice(split + 1);
    const joinedOn = joinedOnByUserId.get(uid);
    // Backfilled absences in the destination group must not erase the mark
    // saved in the previous group before this member joined.
    if (joinedOn && date < joinedOn && attendance[uid]?.[date] !== undefined) continue;
    write(key, present);
  }

  return { attendance, groupSessionDates, sessionDates: [...sessionDates].sort() };
}

/** Membership timestamps are UTC; attendance dates use the Indian calendar. */
export function bvMembershipJoinedOn(value: unknown): string {
  if (!value) return '';
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? new Date(time + 330 * 60_000).toISOString().slice(0, 10) : '';
}
