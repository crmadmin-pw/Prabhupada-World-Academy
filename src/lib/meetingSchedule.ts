export const MEETING_DAYS = [
  { key: 'mon', label: 'Mon', full: 'Monday' },
  { key: 'tue', label: 'Tue', full: 'Tuesday' },
  { key: 'wed', label: 'Wed', full: 'Wednesday' },
  { key: 'thu', label: 'Thu', full: 'Thursday' },
  { key: 'fri', label: 'Fri', full: 'Friday' },
  { key: 'sat', label: 'Sat', full: 'Saturday' },
  { key: 'sun', label: 'Sun', full: 'Sunday' },
] as const;

export type MeetingDayKey = (typeof MEETING_DAYS)[number]['key'];

const DAY_ORDER = new Map(MEETING_DAYS.map((day, index) => [day.key, index]));

export function sortMeetingDays(days: readonly MeetingDayKey[]): MeetingDayKey[] {
  return [...new Set(days)].sort((left, right) => (DAY_ORDER.get(left) ?? 0) - (DAY_ORDER.get(right) ?? 0));
}

/** "13:05" -> "1:05 PM". Returns "" when the value is not a 24-hour time. */
export function formatClock(value24: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value24.trim());
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function clockToMinutes(value24: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value24.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatMeetingDays(days: readonly MeetingDayKey[]): string {
  const ordered = sortMeetingDays(days);
  if (ordered.length === 0) return '';
  if (ordered.length === MEETING_DAYS.length) return 'Everyday';
  const keys = ordered.join(',');
  if (keys === 'mon,tue,wed,thu,fri') return 'Monday to Friday';
  if (keys === 'sat,sun') return 'Saturday & Sunday';
  const labels = new Map(MEETING_DAYS.map(day => [day.key, day.full]));
  return ordered.map(day => labels.get(day) || day).join(', ');
}

/** Stored on the group as one readable schedule, for example "1:00 PM – 1:30 PM (Monday to Friday)". */
export function formatMeetingSchedule(startTime: string, endTime: string, days: readonly MeetingDayKey[]): string {
  const start = formatClock(startTime);
  const end = formatClock(endTime);
  const dayLabel = formatMeetingDays(days);
  if (!start || !end || !dayLabel) return '';
  return `${start} – ${end} (${dayLabel})`;
}

export function meetingScheduleError(startTime: string, endTime: string, days: readonly MeetingDayKey[]): string | null {
  if (!formatClock(startTime) || !formatClock(endTime)) return 'Please choose a start time and an end time';
  const start = clockToMinutes(startTime);
  const end = clockToMinutes(endTime);
  if (start == null || end == null || end <= start) return 'End time must be after the start time';
  if (sortMeetingDays(days).length === 0) return 'Please select at least one day';
  return null;
}
