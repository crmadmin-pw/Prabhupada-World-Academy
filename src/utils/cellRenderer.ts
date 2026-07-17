/**
 * SSOT: Single Source of Truth for sadhana table cell rendering.
 *
 * Both the dashboard table (SadhanaDetailTable) and the export image (exportReportImage)
 * call `computeCell()` to get the display text and color type for every data cell.
 * This prevents the two views from drifting apart.
 */

// --- Minimal types (structural match for UserRow / FieldDef in SadhanaDetailTable) ---
export interface CellUserRow {
  userId: string;
  isResident: boolean;
  submitted: boolean;
  flagSick: boolean;
  flagOs: boolean;
  fieldScores: Record<string, number | string | null>;
  fieldRawValues?: Record<string, number | string | null>;
  nrFieldNA?: Record<string, boolean>;
  nrFieldLeaderboard?: Record<string, boolean>;
}

export interface CellFieldDef {
  key: string;
  maxPoints: number | null;
  isScoring: boolean;
  forResident: boolean;
  forNR: boolean;
}

// --- Color types ----------------------------------------------------------------
export type ColorType =
  | 'green'      // bg-green-100 text-green-700 (full score)
  | 'amber'      // bg-amber-100 text-amber-700 (partial)
  | 'red'        // bg-red-100 text-red-600 (zero)
  | 'purple'     // bg-purple-100 text-purple-700 (bonus/negative)
  | 'greenText'  // no bg, text-green-700 (preaching/books)
  | 'amberText'  // no bg, text-amber-700 (warning ⚠️)
  | 'neutral'    // no bg, foreground text (time, leaderboard-only NR)
  | 'muted'      // bg-muted text-muted (sick/OS greyed out)
  | 'na'         // bg-muted text-muted (N/A cell)
  | 'none';      // not submitted or empty

export interface CellRenderResult {
  displayText: string;
  colorType: ColorType;
  isNA: boolean;
}

// --- Constants ------------------------------------------------------------------
/** Fields stored as raw minutes that should be displayed as HH:MM */
const DURATION_MINUTE_KEYS = new Set([
  'study_minutes', 'sleep_minutes', 'preaching_minutes', 'preaching_raw', 'nr_preaching',
  // "All" view common fields — reading/hearing/preaching are raw minutes
  'common_reading', 'common_hearing', 'common_preaching',
]);

/** Time fields that need to be shown in 12h AM/PM format */
const TIME_DISPLAY_KEYS = new Set(['japa_finish_time', 'wakeUptime', 'sleepTime']);

/** These columns never get colored backgrounds (informational fields only) */
const NO_COLOR_KEYS = new Set(['japa_finish_time', 'sleep_minutes']);

/** Duration fields with threshold-based coloring: green ≥ threshold, amber ≥ mid, red below */
const DURATION_THRESHOLD_KEYS: Record<string, { green: number; amber: number }> = {
};

/** These fields show green text when the value > 0 */
const GREEN_POSITIVE_KEYS = new Set([
  'preaching_raw', 'preaching_minutes', 'distribution_raw', 'books_distributed',
  'nr_preaching', 'nr_books', 'study_minutes',
  // "All" view common fields
  'common_preaching', 'common_books',
]);

/** Fields that stay scored (not greyed) even when user is Sick or OS — Residents */
const RESIDENT_SICK_OS_SCORED = new Set([
  'rounds', 'sp_reading', 'sp_reading_minutes', 'report_sending', 'rounds_count', 'fillingSameDay',
]);

/** Fields that stay scored (not greyed) even when user is Sick or OS — NR */
const NR_SICK_OS_SCORED = new Set(['chanting', 'reading', 'fillingSameDay']);

// --- Helpers --------------------------------------------------------------------
function minutesToHHMM(mins: number): string {
  const rounded = Math.round(mins);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHHMM(timeStr: string): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function to12h(time24: string): string {
  if (!time24) return '';
  const match = time24.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return time24;
  let h = parseInt(match[1]);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/** Format a raw value for display according to field type. */
function formatValue(fieldKey: string, val: unknown, showRealValues: boolean): string {
  if (val === null || val === undefined) return '';

  // Duration fields (stored as raw minutes) → HH:MM
  if (DURATION_MINUTE_KEYS.has(fieldKey)) {
    const mins = Number(val);
    if (isNaN(mins) || mins < 0) return '';
    return minutesToHHMM(mins);
  }

  // In "Show Real Values" mode, sp_reading / reading / hearing are raw minutes → HH:MM
  if (showRealValues && (fieldKey === 'sp_reading' || fieldKey === 'reading' || fieldKey === 'hearing') && typeof val === 'number') {
    return minutesToHHMM(val);
  }

  // Time fields → 12h AM/PM
  if (TIME_DISPLAY_KEYS.has(fieldKey) && typeof val === 'string' && val.match(/^\d{1,2}:\d{2}$/)) {
    const mins = parseHHMM(val);
    // Treat 00:00 as "not entered" → show blank (midnight japa/sleep is not realistic)
    if (mins === 0) return '';
    const display12 = to12h(val);
    if (fieldKey === 'japa_finish_time') {
      if (mins !== null && mins < 5 * 60) return `⚠️ ${display12}`;
    }
    return display12;
  }

  if (typeof val === 'number') {
    return String(parseFloat((Math.round(val * 100) / 100).toFixed(2)));
  }

  const strVal = String(val);
  if (fieldKey === 'japa_finish_time') {
    const mins = parseHHMM(strVal);
    if (mins === 0) return ''; // 00:00 = not entered
    if (mins !== null && mins < 5 * 60) return `⚠️ ${strVal}`;
  }
  return strVal;
}

// --- Main exported function -----------------------------------------------------

/**
 * Compute the display text and color type for a single sadhana table cell.
 *
 * @param user        The user row data
 * @param field       The field definition
 * @param showRealValues  When true, display raw input values (but still color by scored points)
 */
export function computeCell(
  user: CellUserRow,
  field: CellFieldDef,
  showRealValues = false,
): CellRenderResult {
  const applicable = user.isResident ? field.forResident : field.forNR;

  // Field not applicable for this user's type (e.g. resident field shown to NR)
  if (!applicable) {
    return { displayText: 'NA', colorType: 'na', isNA: true };
  }

  // NR level-specific N/A (e.g. wakeUptime NA for Jigyasa)
  if (!user.isResident && user.nrFieldNA?.[field.key]) {
    return { displayText: 'NA', colorType: 'na', isNA: true };
  }

  // User hasn't submitted
  if (!user.submitted) {
    return { displayText: '', colorType: 'none', isNA: false };
  }

  // --- Determine display value ------------------------------------------------
  // Always use scored points for color; use raw values for display text when:
  //  a) showRealValues mode is on, OR
  //  b) NR time fields (fieldScores holds points, not the actual time string)
  const scoredVal = user.fieldScores[field.key] ?? null;

  let displayVal: unknown;
  if (showRealValues && user.fieldRawValues != null) {
    const rv = user.fieldRawValues[field.key];
    displayVal = rv !== undefined ? rv : scoredVal;
  } else if (!user.isResident && TIME_DISPLAY_KEYS.has(field.key) && user.fieldRawValues?.[field.key] != null) {
    // NR time fields: fieldScores contains points; raw string lives in fieldRawValues
    displayVal = user.fieldRawValues[field.key];
  } else {
    displayVal = scoredVal;
  }

  const rawDisplayText =
    displayVal !== null && displayVal !== undefined
      ? formatValue(field.key, displayVal, showRealValues)
      : '';

  // NF display: for japa_finish_time and sleep_minutes, show plain "NF" when not filled
  if (field.key === 'japa_finish_time' && rawDisplayText === '') {
    return { displayText: 'NF', colorType: 'neutral', isNA: false };
  }
  if (field.key === 'sleep_minutes' && (rawDisplayText === '00:00' || rawDisplayText === '')) {
    return { displayText: 'NF', colorType: 'neutral', isNA: false };
  }

  // Study/Preaching/Books: null/empty means 0 (user submitted but did none) — show zero value explicitly
  if (rawDisplayText === '') {
    if (
      field.key === 'preaching_raw' || field.key === 'nr_preaching' ||
      field.key === 'preaching_minutes' || field.key === 'study_minutes' ||
      field.key === 'common_preaching'
    ) {
      return { displayText: '00:00', colorType: 'neutral', isNA: false };
    }
    if (field.key === 'distribution_raw' || field.key === 'nr_books' || field.key === 'common_books') {
      return { displayText: '0', colorType: 'neutral', isNA: false };
    }
  }

  const displayText = rawDisplayText;

  // --- Determine color type ---------------------------------------------------
  // Warning takes priority
  if (displayText.startsWith('⚠️')) {
    return { displayText, colorType: 'amberText', isNA: false };
  }

  // Sick/OS: grey out non-exempt scored fields
  const isSickOs = user.flagSick || user.flagOs;
  const sickOsScored = user.isResident ? RESIDENT_SICK_OS_SCORED : NR_SICK_OS_SCORED;
  if (isSickOs && field.isScoring && field.maxPoints != null && field.maxPoints > 0 && !sickOsScored.has(field.key)) {
    return { displayText, colorType: 'muted', isNA: false };
  }

  // Leaderboard-only NR field → no color, just show the value
  if (!user.isResident && user.nrFieldLeaderboard?.[field.key]) {
    return { displayText, colorType: 'neutral', isNA: false };
  }

  // No-color informational fields (japa finish time)
  if (NO_COLOR_KEYS.has(field.key)) {
    return { displayText, colorType: 'neutral', isNA: false };
  }

  // Duration threshold-based coloring (study, sleep — shown as HH:MM with green/amber/red bg)
  const durThreshold = DURATION_THRESHOLD_KEYS[field.key];
  if (durThreshold) {
    // Get the raw numeric value (minutes) for threshold comparison
    const rawMins = typeof scoredVal === 'number' ? scoredVal
      : typeof scoredVal === 'string' ? parseHHMM(scoredVal) ?? 0 : 0;
    if (rawMins <= 0) return { displayText, colorType: displayText ? 'red' : 'none', isNA: false };
    if (rawMins >= durThreshold.green) return { displayText, colorType: 'green', isNA: false };
    if (rawMins >= durThreshold.amber) return { displayText, colorType: 'amber', isNA: false };
    return { displayText, colorType: 'red', isNA: false };
  }

  // Green-positive fields (preaching, books)
  const val = scoredVal; // always use SCORED value for color
  if (GREEN_POSITIVE_KEYS.has(field.key) && typeof val === 'number' && val > 0) {
    return { displayText, colorType: 'greenText', isNA: false };
  }

  // Standard point-based coloring
  if (typeof val === 'number' && field.maxPoints != null && field.maxPoints > 0) {
    if (val >= field.maxPoints) return { displayText, colorType: 'green', isNA: false };
    if (val < 0)               return { displayText, colorType: 'purple', isNA: false };
    if (val === 0)             return { displayText, colorType: 'red', isNA: false };
    return { displayText, colorType: 'amber', isNA: false };
  }

  // Fallback: no color
  return { displayText, colorType: 'neutral', isNA: false };
}

/** Map a ColorType to Tailwind CSS classes for the dashboard table */
export function colorTypeToClass(colorType: ColorType): string {
  switch (colorType) {
    case 'green':     return 'bg-green-100 text-green-700 font-semibold text-center';
    case 'amber':     return 'bg-amber-100 text-amber-700 text-center';
    case 'red':       return 'bg-red-100 text-red-600 text-center';
    case 'purple':    return 'bg-purple-100 text-purple-700 font-semibold text-center';
    case 'greenText': return 'text-green-700 font-semibold text-center';
    case 'amberText': return 'text-amber-700 font-semibold text-center';
    case 'neutral':   return 'text-center text-foreground';
    case 'muted':     return 'bg-muted/20 text-muted-foreground/50 text-center';
    case 'na':        return 'bg-muted/20 text-muted-foreground/40 text-center';
    case 'none':      return 'text-center';
    default:          return 'text-center';
  }
}
