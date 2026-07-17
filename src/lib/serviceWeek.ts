/**
 * FOLK Service Management week helpers.
 * Weeks run Sunday → Saturday (different from the sadhana/leaderboard Mon → Sun).
 * All service-related components and endpoints import from here.
 */

export const SERVICE_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type ServiceDay = typeof SERVICE_DAYS[number];

export const SERVICE_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SERVICE_DAY_FULL: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

/** Maps full day names to their 0-based offset from Sunday (the week start). */
export const SERVICE_DAY_OFFSETS: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

/** Maps short 3-letter keys to full day names. */
export const SERVICE_DOW_MAP: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

/** Maps short 3-letter keys to 0-based index from Sunday. */
export const SERVICE_DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/** Returns the ISO date (yyyy-MM-dd) of the most recent Sunday (today if Sunday). */
export function getCurrentServiceWeekStart(): string {
  const today = new Date();
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay()); // getDay() 0=Sun → offset 0
  return sun.toISOString().split('T')[0];
}

/** Returns the ISO date of the Sunday starting the week that contains `date`. */
export function getServiceWeekStartOf(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

/** Returns the service week Sunday for a given offset (0 = current, 1 = next, -1 = last). */
export function getServiceWeekByOffset(offset = 0): string {
  const today = new Date();
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay() + offset * 7);
  return sun.toISOString().split('T')[0];
}
