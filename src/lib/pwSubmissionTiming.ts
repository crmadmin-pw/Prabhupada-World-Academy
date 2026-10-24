const DAY_MS = 86_400_000;

function validDate(date: string): boolean {
  const time = Date.parse(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

export function shiftSadhanaDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function pwEntryDateBounds(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  return { min: shiftSadhanaDate(today, -7), max: today };
}

export function pwSubmissionError(entryDate: string, now = new Date()): string | null {
  if (!validDate(entryDate)) return 'Invalid entry date';
  const bounds = pwEntryDateBounds(now);
  if (entryDate > bounds.max) return 'Cannot submit for a future date';
  if (entryDate < bounds.min) return 'Cannot submit for dates older than 7 days';
  if (now.getTime() < Date.parse(`${entryDate}T18:00:00+05:30`)) return 'PW Sadhana submission opens at 6:00 PM IST on the Sadhana date';
  return null;
}

export function pwTimelySubmissionPoints(entryDate: string, submittedAt: string | null | undefined): number {
  if (!validDate(entryDate) || !submittedAt) return 0;
  const submitted = Date.parse(submittedAt);
  const opens = Date.parse(`${entryDate}T18:00:00+05:30`);
  if (!Number.isFinite(submitted) || submitted < opens) return 0;
  const nextDay = shiftSadhanaDate(entryDate, 1);
  if (submitted <= Date.parse(`${nextDay}T10:00:00+05:30`)) return 2;
  if (submitted <= Date.parse(`${nextDay}T14:00:00+05:30`)) return 1;
  return 0;
}
