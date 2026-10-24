const DAY_MS = 86_400_000;
export const DEFAULT_PW_TIME_ZONE = 'Asia/Kolkata';

/** Persist an IANA zone, rather than an offset that becomes stale after DST. */
export function normalizeSadhanaTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /^[+-]/.test(value.trim())) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: value.trim() }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function browserSadhanaTimeZone(): string {
  if (typeof window === 'undefined') return DEFAULT_PW_TIME_ZONE;
  return normalizeSadhanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) || DEFAULT_PW_TIME_ZONE;
}

function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeSadhanaTimeZone(timeZone) || DEFAULT_PW_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: string) => parts.find(part => part.type === type)!.value;
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    milliseconds: ((Number(read('hour')) % 24) * 3600 + Number(read('minute')) * 60 + Number(read('second'))) * 1000 + now.getUTCMilliseconds(),
  };
}

function validDate(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

export function shiftSadhanaDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function pwEntryDateBounds(now = new Date(), timeZone = DEFAULT_PW_TIME_ZONE) {
  const today = localClock(now, timeZone).date;
  return { min: shiftSadhanaDate(today, -7), max: today };
}

/** Today's PW Sadhana form remains unavailable until the evening reporting window opens. */
export function isPwSadhanaFormLocked(entryDate: string, now = new Date(), timeZone = DEFAULT_PW_TIME_ZONE): boolean {
  if (!validDate(entryDate)) return false;
  const local = localClock(now, timeZone);
  return local.date === entryDate && local.milliseconds < 18 * 3_600_000;
}

export function pwSubmissionError(entryDate: string, now = new Date(), timeZone = DEFAULT_PW_TIME_ZONE): string | null {
  if (!validDate(entryDate)) return 'Invalid entry date';
  const bounds = pwEntryDateBounds(now, timeZone);
  if (entryDate > bounds.max) return 'Cannot submit for a future date';
  if (entryDate < bounds.min) return 'Cannot submit for dates older than 7 days';
  if (isPwSadhanaFormLocked(entryDate, now, timeZone)) {
    return `PW Sadhana submission opens at 6:00 PM on the Sadhana date (${timeZone})`;
  }
  return null;
}

export function pwTimelySubmissionPoints(entryDate: string, submittedAt: string | null | undefined, timeZone = DEFAULT_PW_TIME_ZONE): number {
  if (!validDate(entryDate) || !submittedAt) return 0;
  const submitted = new Date(submittedAt);
  if (!Number.isFinite(submitted.getTime())) return 0;
  const local = localClock(submitted, timeZone);
  if (local.date < entryDate || (local.date === entryDate && local.milliseconds < 18 * 3_600_000)) return 0;
  if (local.date === entryDate) return 2;
  const nextDay = shiftSadhanaDate(entryDate, 1);
  if (local.date !== nextDay) return 0;
  if (local.milliseconds <= 10 * 3_600_000) return 2;
  if (local.milliseconds <= 14 * 3_600_000) return 1;
  return 0;
}
