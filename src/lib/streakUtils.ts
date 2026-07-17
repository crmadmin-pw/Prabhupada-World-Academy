/**
 * Compute the current sadhana streak from a list of entries.
 *
 * SSOT — single source of truth for all streak computation across the entire app.
 * Used by: getUserDashboardData, getUserMetrics, getUserDetailForGuide,
 *          getMentorMembers, getGuideDetailedReport, getSadhanaLeaderboard, submitSadhana.
 *
 * Rules:
 *  - A day qualifies if scorePercent >= 75 (threshold).
 *  - Counts consecutive qualifying days backwards from today (IST).
 *  - If today has no qualifying entry yet, counts from yesterday so the
 *    streak stays alive until end-of-day even if not yet submitted.
 *  - Uses pure UTC date arithmetic — no local timezone drift.
 */
export function computeStreak(
  entries: Array<{ entryDate?: string | null; scorePercent?: number | null }>,
  todayIST: string,
  threshold = 75,
): number {
  if (!entries.length) return 0;

  // Build a set of YYYY-MM-DD strings that meet the threshold
  const qualifying = new Set(
    entries
      .filter(e => e.entryDate && (e.scorePercent ?? 0) >= threshold)
      .map(e => (e.entryDate as string).slice(0, 10))
  );

  let checkDate = todayIST;

  // If today not yet submitted (or score too low), preserve streak until EOD
  if (!qualifying.has(checkDate)) {
    checkDate = subtractOneDay(checkDate);
  }

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (qualifying.has(checkDate)) {
      streak++;
      checkDate = subtractOneDay(checkDate);
    } else {
      break;
    }
  }
  return streak;
}

/** Subtract one day from a YYYY-MM-DD string using pure UTC math (no local timezone drift) */
function subtractOneDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** Get IST "today" string (YYYY-MM-DD) — server runs UTC, users are in India */
export function getTodayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/** Get the YYYY-MM-DD string that is N days before the given ISO date */
export function daysAgo(fromISO: string, n: number): string {
  const [year, month, day] = fromISO.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - n);
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
