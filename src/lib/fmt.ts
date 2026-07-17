// ══════════════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH — All formatting helpers
// Import from '@/lib/fmt' everywhere. Never format inline.
// ══════════════════════════════════════════════════════════════════════════════

import { format, parseISO, isValid } from 'date-fns';

/**
 * Safely parse a date string (ISO or any valid date string).
 * Returns null if invalid.
 */
function safeParse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  try {
    const d = parseISO(value);
    if (isValid(d)) return d;
    const d2 = new Date(value);
    return isValid(d2) ? d2 : null;
  } catch {
    return null;
  }
}

export const fmt = {
  /**
   * Format a date to "DD MMM YYYY" (e.g. "05 Jun 2025")
   */
  date(value: string | Date | null | undefined): string {
    const d = safeParse(value as any);
    if (!d) return '—';
    return format(d, 'dd MMM yyyy');
  },

  /**
   * Format a date to short "DD MMM" (e.g. "05 Jun")
   */
  dateShort(value: string | Date | null | undefined): string {
    const d = safeParse(value as any);
    if (!d) return '—';
    return format(d, 'dd MMM');
  },

  /**
   * Format date to "Mon, 05 Jun 2025"
   */
  dateFull(value: string | Date | null | undefined): string {
    const d = safeParse(value as any);
    if (!d) return '—';
    return format(d, 'EEE, dd MMM yyyy');
  },

  /**
   * Format to ISO date string "YYYY-MM-DD" (for API calls, keys)
   */
  dateISO(value: string | Date | null | undefined): string {
    const d = safeParse(value as any);
    if (!d) return '';
    return format(d, 'yyyy-MM-dd');
  },

  /**
   * Format a percentage — returns "75%" or "—" if null
   * @param decimals number of decimal places (default 0)
   */
  percent(value: number | null | undefined, decimals = 0): string {
    if (value == null) return '—';
    return `${value.toFixed(decimals)}%`;
  },

  /**
   * Format a score value — returns "42" or "—" if null
   */
  score(value: number | null | undefined): string {
    if (value == null) return '—';
    return String(Math.round(value));
  },

  /**
   * Format minutes as human-readable duration.
   * e.g. 90 → "1h 30m", 45 → "45m", 0/null → "—"
   */
  duration(minutes: number | null | undefined): string {
    if (minutes == null || minutes <= 0) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    return `${m}min`;
  },

  /**
   * Format a time string HH:MM to "6:30 AM" style.
   */
  time(value: string | null | undefined): string {
    if (!value) return '—';
    const [hStr, mStr] = value.split(':');
    const h = parseInt(hStr);
    const m = parseInt(mStr);
    if (isNaN(h) || isNaN(m)) return value;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
  },

  /**
   * Shorten a full name to "First L." (e.g. "Radha Mohan Das" → "Radha M.")
   */
  shortName(fullName: string | null | undefined): string {
    if (!fullName) return '—';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[1][0]}.`;
  },

  /**
   * Format a number with optional fallback. Returns "—" for null/undefined.
   */
  number(value: number | null | undefined, decimals = 0): string {
    if (value == null) return '—';
    return value.toFixed(decimals);
  },

  /**
   * Round a number to at most `maxDecimals` decimal places (default 2). Null-safe.
   * Use this before displaying any calculated/averaged number to prevent long floats.
   * e.g. round2(13.46684868684) → 13.47, round2(7.5) → 7.5
   */
  round2(value: number | null | undefined, maxDecimals = 2): number | null {
    if (value == null) return null;
    const factor = Math.pow(10, maxDecimals);
    return Math.round(value * factor) / factor;
  },

  /**
   * Format a number for display, rounded to max 2 decimal places. Returns "—" for null.
   */
  numDisplay(value: number | null | undefined, maxDecimals = 2): string {
    if (value == null) return '—';
    const factor = Math.pow(10, maxDecimals);
    const rounded = Math.round(value * factor) / factor;
    // Remove trailing zeros: 7.50 → "7.5", 7.00 → "7"
    return String(parseFloat(rounded.toFixed(maxDecimals)));
  },

  /**
   * Format a week range label: "Week of 02 Jun – 08 Jun"
   */
  weekLabel(startDate: string | null | undefined, endDate?: string | null): string {
    const start = safeParse(startDate as any);
    if (!start) return '—';
    const startStr = format(start, 'dd MMM');
    if (!endDate) return `Week of ${startStr}`;
    const end = safeParse(endDate as any);
    if (!end) return `Week of ${startStr}`;
    return `${startStr} – ${format(end, 'dd MMM')}`;
  },
};
