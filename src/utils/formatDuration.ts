// SAD-H05 FIX: canonical duration display utility — use everywhere duration minutes are rendered

/**
 * Format raw minutes into human-readable duration string.
 * e.g. 90 → "1h 30m", 45 → "45m", 120 → "2h", 0/null → "—"
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
