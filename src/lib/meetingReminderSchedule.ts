/**
 * PW meetings have exactly two reminder moments. Each scheduler window is one
 * minute wide so a missed 10-minute tick cannot become an unexpected
 * two-minute (or otherwise late) notification.
 */
export const MEETING_REMINDERS = [
  { type: 'TEN_MINUTES', minutes: 10, sentField: 'notification10mSent', untilMinutes: 9 },
  { type: 'ONE_MINUTE', minutes: 1, sentField: 'notification1mSent', untilMinutes: 0 },
] as const;
export type MeetingReminderType = typeof MEETING_REMINDERS[number]['type'];

export function meetingStartMs(value: string): number {
  // Stored datetime-local values are IST. Preserve explicit positive/negative offsets.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  return new Date(value.includes('T') && !hasZone ? `${value}+05:30` : value).getTime();
}

/** A meeting can be scheduled only for a start that is still ahead. */
export function pastMeetingTimeMessage(scheduledAt: string, nowMs = Date.now()): string | null {
  const start = meetingStartMs(String(scheduledAt || '').trim());
  if (!Number.isFinite(start)) return 'Please choose a valid meeting date and time';
  if (start <= nowMs) return 'Meeting time has already passed. Choose a future time.';
  return null;
}

export function reminderWindow(start: number, type: MeetingReminderType) {
  const reminder = MEETING_REMINDERS.find(item => item.type === type)!;
  return { from: start - reminder.minutes * 60_000, until: start - reminder.untilMinutes * 60_000 };
}
