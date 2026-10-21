function firstValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

export type ReportAttendanceRecord = {
  user?: unknown;
  group?: unknown;
  groupId?: unknown;
  present?: unknown;
  attendanceDate?: unknown;
};

/**
 * Attendance follows the member's current reading group.
 * A present mark from the group she left must not override an absence, or a
 * session day with no mark, in the group she joined.
 */
export function mergeReportAttendance(
  records: ReportAttendanceRecord[],
  memberGroupByUserId: Map<string, string>,
  userIdFor: (reference: string) => string,
  groupIdFor: (reference: string) => string,
): {
  attendance: Record<string, Record<string, boolean>>;
  groupSessionDates: Map<string, Set<string>>;
  sessionDates: string[];
} {
  const groupSessionDates = new Map<string, Set<string>>();
  const sessionDates = new Set<string>();
  const current = new Map<string, boolean>();
  const former = new Map<string, boolean>();

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
    if (inCurrentGroup) current.set(key, !!record.present);
    else former.set(key, !!record.present);
  }

  const attendance: Record<string, Record<string, boolean>> = {};
  const write = (key: string, present: boolean) => {
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
    if (memberGroup && groupSessionDates.get(memberGroup)?.has(date)) continue;
    write(key, present);
  }
  for (const [key, present] of current) write(key, present);

  return { attendance, groupSessionDates, sessionDates: [...sessionDates].sort() };
}
