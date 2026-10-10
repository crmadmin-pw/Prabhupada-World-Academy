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

const DAY_WORDS: Record<string, MeetingDayKey> = {
  mon: 'mon', monday: 'mon',
  tue: 'tue', tues: 'tue', tuesday: 'tue',
  wed: 'wed', wednesday: 'wed',
  thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu',
  fri: 'fri', friday: 'fri',
  sat: 'sat', saturday: 'sat',
  sun: 'sun', sunday: 'sun',
};

function expandDayRange(start: MeetingDayKey, end: MeetingDayKey): MeetingDayKey[] {
  const startIndex = DAY_ORDER.get(start) ?? 0;
  const endIndex = DAY_ORDER.get(end) ?? startIndex;
  if (endIndex < startIndex) return [start, end];
  return MEETING_DAYS.slice(startIndex, endIndex + 1).map(day => day.key);
}

function daysFromPhrase(raw: string): MeetingDayKey[] {
  const cleaned = raw
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\b([a-z]+)\s*-\s*([a-z]+)\b/g, '$1 to $2')
    .replace(/&/g, ' and ');
  const compact = cleaned.replace(/[^a-z]/g, '');
  if (['everyday', 'daily', 'alldays', 'allweek'].includes(compact)) {
    return MEETING_DAYS.map(day => day.key);
  }
  if (compact === 'weekdays' || compact === 'weekday') return ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (compact === 'weekends' || compact === 'weekend') return ['sat', 'sun'];

  const tokens = cleaned.split(/[^a-z]+/).filter(Boolean);
  const days: MeetingDayKey[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const day = DAY_WORDS[tokens[index]];
    if (!day) continue;
    const link = tokens[index + 1];
    const nextDay = DAY_WORDS[tokens[index + 2] || ''];
    if ((link === 'to' || link === 'through') && nextDay) {
      days.push(...expandDayRange(day, nextDay));
      index += 2;
      continue;
    }
    days.push(day);
  }
  return sortMeetingDays(days);
}

function clockLabel(hour: number, minute: number, period: 'AM' | 'PM'): string {
  return `${hour}:${String(minute).padStart(2, '0')} ${period}`;
}

/**
 * One dropdown label: "1:00 PM – 1:30 PM (Monday to Friday)".
 * Older groups stored the same slot as "1:30PM–2:00pm(Mon-Fri)" or "1:00 -1:30 pm mon to fri".
 */
export function formatReadingGroupTimeSlot(raw: string): string {
  const text = raw.replace(/[–—−]/g, '-').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  const timePattern = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/gi;
  const times: { hour: number; minute: number; period: 'AM' | 'PM' | null; index: number; length: number }[] = [];
  for (const match of text.matchAll(timePattern)) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour < 1 || hour > 12 || minute > 59) continue;
    const periodRaw = match[3]?.replace(/\./g, '').toUpperCase();
    const period = periodRaw === 'AM' || periodRaw === 'PM' ? periodRaw : null;
    times.push({ hour, minute, period, index: match.index ?? 0, length: match[0].length });
    if (times.length === 2) break;
  }
  if (times.length < 2) return text;

  const startPeriod = times[0].period || times[1].period;
  const endPeriod = times[1].period || times[0].period;
  if (!startPeriod || !endPeriod) return text;

  let remainder = text;
  for (const span of [...times].sort((left, right) => right.index - left.index)) {
    remainder = `${remainder.slice(0, span.index)} ${remainder.slice(span.index + span.length)}`;
  }
  const dayLabel = formatMeetingDays(daysFromPhrase(remainder));
  const schedule = `${clockLabel(times[0].hour, times[0].minute, startPeriod)} – ${clockLabel(times[1].hour, times[1].minute, endPeriod)}`;
  return dayLabel ? `${schedule} (${dayLabel})` : schedule;
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
