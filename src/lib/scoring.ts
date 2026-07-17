// ══════════════════════════════════════════════════════════════════════════════
// PURE SCORING ENGINE — Zero React dependencies. Fully testable.
// Import from '@/lib/scoring' in any component or hook.
// ══════════════════════════════════════════════════════════════════════════════

import type { SadhanaField, FieldOption, ParsedOption, FieldScore, ScoreResult } from '@/types/models';
import { TIME_BUCKETS } from '@/types/enums';
import { differenceInDays } from 'date-fns';

// ─── Field Type Normalization ────────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  radio: 'radio', select: 'dropdown', dropdown: 'dropdown',
  multiselect: 'multiselect', checkbox: 'multiselect', time: 'time',
  duration: 'duration', text: 'text', number: 'number', toggle: 'toggle',
};

const FORCED_DURATION_KEYS = new Set(['preaching_minutes', 'preaching_raw', 'sleep_minutes']);
const FORCED_TIME_KEYS_EXTRA = new Set(['sleepTime']);
const FORCED_TIME_KEYS = new Set<string>();

export function normalizeFieldType(fieldType: string, fieldKey?: string): string {
  if (fieldKey && FORCED_DURATION_KEYS.has(fieldKey)) return 'duration';
  if (fieldKey && (FORCED_TIME_KEYS.has(fieldKey) || FORCED_TIME_KEYS_EXTRA.has(fieldKey))) return 'time';
  return TYPE_MAP[fieldType.toLowerCase().trim()] || 'text';
}

// ─── Option Parsing ──────────────────────────────────────────────────────────

export function parseNumericValue(value: any): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Normalize Unicode minus sign (U+2212 −) to ASCII hyphen before parsing
    const normalized = value.replace(/\u2212/g, '-');
    const match = normalized.match(/-?\d+/);
    if (match) return parseInt(match[0]);
  }
  return 0;
}

export function parseOptions(field: SadhanaField): ParsedOption[] {
  if (!field.options || field.options.length === 0) return [];
  return field.options.map(opt => {
    const displayLabel = opt.label || String(opt.value);
    const storedValue = opt.value !== undefined ? opt.value : opt.points;
    let pointsValue = 0;
    if (opt.points !== undefined) pointsValue = parseNumericValue(opt.points);
    else if (opt.value !== undefined) pointsValue = parseNumericValue(opt.value);
    else if (opt.label) pointsValue = parseNumericValue(opt.label);
    return { displayLabel, storedValue, pointsValue };
  });
}

export function parseCriteria(criteriaString: string | undefined | null): any {
  if (!criteriaString) return null;
  try { return JSON.parse(criteriaString); } catch { return null; }
}

// ─── Time Bucket ─────────────────────────────────────────────────────────────

export function getTimeBucket(joinDate: string | undefined, entryDate: string): string {
  if (!joinDate) return TIME_BUCKETS.ZERO_TO_THREE;
  try {
    const join = new Date(joinDate);
    const entry = new Date(entryDate);
    const daysDiff = differenceInDays(entry, join);
    if (daysDiff >= 180) return TIME_BUCKETS.MORE_THAN_SIX;
    if (daysDiff >= 90) return TIME_BUCKETS.THREE_TO_SIX;
    return TIME_BUCKETS.ZERO_TO_THREE;
  } catch { return TIME_BUCKETS.ZERO_TO_THREE; }
}

// ─── NR (Non-Resident) Criteria ──────────────────────────────────────────────

export function isNRCriteria(criteria: any): boolean {
  // Detect NR criteria by presence of a 'levels' map (the actual DB format)
  return criteria && (criteria.nr === true || (typeof criteria.levels === 'object' && criteria.levels !== null));
}

function parseHHMM(timeStr: string): number {
  if (!timeStr) return 0;
  const s = String(timeStr).trim();
  // Handle AM/PM format from DB criteria (e.g. "6:00 AM", "11:00 PM")
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1]);
    const m = parseInt(ampmMatch[2]);
    const isPM = ampmMatch[3].toUpperCase() === 'PM';
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return h * 60 + m;
  }
  const match = s.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/** Normalize descriptive penalty_rule strings from the DB to code-friendly keys */
function normalizePenaltyRule(raw: string): string {
  const r = (raw || '').toLowerCase();
  if (r.includes('pro rata')) return 'pro_rata';
  if (r.includes('15 min') || (r.includes('time') && r.includes('delay'))) return 'time_delay';
  if (r.includes('day')) return 'day_delay';
  if (r.includes('toggle')) return 'toggle_scored';
  return r;
}

export function calculateNRPoints(
  criteria: any,
  value: any,
  ashrayLevel: string,
  entryDate: string,
  submittedAt?: string
): FieldScore {
  const empty: FieldScore = { fieldKey: '', points: 0, maxPoints: 0, target: null, isLeaderboard: false };
  if (!criteria || !criteria.levels) return empty;

  // 2.5 FIX: Normalize ashray level to a consistent key before lookup.
  // DB and enums use spaces ('Harinam Diksha'); sadhanaFields.ts criteria use underscores ('Harinam_Diksha').
  // Try space-separated first (canonical), then underscore variant.
  const levelSpaces = (ashrayLevel || '').trim().replace(/_/g, ' ');
  const levelUnder  = levelSpaces.replace(/\s+/g, '_');
  const target = criteria.levels[levelSpaces] ?? criteria.levels[levelUnder] ?? null;
  const totalPoints = criteria.total_points || 0;

  // "-" means not applicable for this ashray level
  if (target === null || target === undefined || target === '-') return empty;
  if (target === 'enabled') return { ...empty, target: 'enabled' };
  // Handle "leaderboard" and "enabled(weekly leaderboard)" variants
  if (target === 'leaderboard' || (typeof target === 'string' && target.toLowerCase().includes('leaderboard'))) {
    return { ...empty, target: 'leaderboard', isLeaderboard: true };
  }

  const rule = normalizePenaltyRule(criteria.penalty_rule);

  if (rule === 'pro_rata') {
    const targetNum = typeof target === 'number' ? target : parseFloat(String(target)) || 0;
    if (targetNum === 0) return { ...empty, maxPoints: totalPoints, target };
    // Toggle fields: ON = full score, OFF = 0
    let actual: number;
    if (typeof value === 'boolean') {
      actual = value ? targetNum : 0;
    } else {
      actual = parseFloat(String(value)) || 0;
    }
    const pts = Math.round(Math.min(actual / targetNum, 1) * totalPoints);
    return { ...empty, points: pts, maxPoints: totalPoints, target };
  }

  if (rule === 'time_delay') {
    const targetMins = parseHHMM(String(target));
    const actualMins = parseHHMM(String(value || ''));
    if (!value || actualMins === 0) return { ...empty, maxPoints: totalPoints, target };
    const delayMins = Math.max(0, actualMins - targetMins);
    const penalty = Math.floor(delayMins / 15) * (criteria.penalty_per_15min || 1);
    return { ...empty, points: Math.max(0, totalPoints - penalty), maxPoints: totalPoints, target };
  }

  if (rule === 'day_delay') {
    const refDate = submittedAt ? new Date(submittedAt) : new Date();
    refDate.setHours(0, 0, 0, 0);
    const entry = new Date(entryDate + 'T00:00:00');
    const dayDelay = Math.max(0, Math.round((refDate.getTime() - entry.getTime()) / 86400000));
    const penalty = dayDelay * (criteria.penalty_per_day || 2);
    return { ...empty, points: Math.max(0, totalPoints - penalty), maxPoints: totalPoints, target: 'all' };
  }

  if (rule === 'toggle_scored') {
    const targetNum = typeof target === 'number' ? target : 0;
    const isOn = value === true;
    return { ...empty, points: isOn ? targetNum : 0, maxPoints: targetNum, target };
  }

  return empty;
}

// ─── Resident Criteria ───────────────────────────────────────────────────────

function matchesCriteriaNote(value: number, note: string): boolean {
  // Match >= or ≥ with explicit equals sign → value >= N
  const greaterEqualMatch = note.match(/[≥>]=\s*(\d+)/);
  if (greaterEqualMatch) return value >= parseInt(greaterEqualMatch[1]);
  // Match strict > (no equals) → value > N
  const strictGreaterMatch = note.match(/>\s*(\d+)/);
  if (strictGreaterMatch) return value > parseInt(strictGreaterMatch[1]);
  const rangeMatch = note.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) return value >= parseInt(rangeMatch[1]) && value <= parseInt(rangeMatch[2]);
  const singleMatch = note.match(/^(\d+)/);
  if (singleMatch) return value === parseInt(singleMatch[1]);
  const lessMatch = note.match(/^<\s*=?\s*(\d+)/);
  if (lessMatch) return value < parseInt(lessMatch[1]);
  return false;
}

export function calculateResidentPoints(
  criteria: any,
  value: any,
  residencyBucket: string
): { points: number; maxPoints: number } {
  if (!criteria) return { points: 0, maxPoints: 0 };
  if (Array.isArray(criteria)) {
    return { points: 0, maxPoints: Math.max(...criteria.map((c: any) => c.points || 0)) };
  }
  if (typeof criteria === 'object' && criteria[residencyBucket]) {
    const bucketCriteria = criteria[residencyBucket];
    if (!Array.isArray(bucketCriteria)) return { points: 0, maxPoints: 0 };
    const maxPts = Math.max(...bucketCriteria.map((c: any) => c.points || 0));
    if (typeof value === 'number' && value > 0) {
      for (const item of bucketCriteria) {
        if (matchesCriteriaNote(value, item.note)) return { points: item.points, maxPoints: maxPts };
      }
    }
    return { points: 0, maxPoints: maxPts };
  }
  return { points: 0, maxPoints: 0 };
}

// ─── Toggle Points ───────────────────────────────────────────────────────────
// BUG-001 FIX: removed subtraction path that caused -2 instead of -1

export function getTogglePoints(field: SadhanaField): number {
  if (!field.options || field.options.length === 0) {
    const criteria = parseCriteria(field.criteria);
    if (typeof criteria === 'number') return criteria;
    return 1;
  }
  // Prefer explicit points field on any option
  const withPts = field.options.find(o => o.points !== undefined);
  if (withPts) return parseNumericValue(withPts.points);
  // Prefer non-zero value (represents the ON/deduction state)
  const nonZero = field.options.find(o => parseNumericValue(o.value) !== 0);
  if (nonZero) return parseNumericValue(nonZero.value);
  const criteria = parseCriteria(field.criteria);
  if (typeof criteria === 'number') return criteria;
  return 1;
}

// ─── Duration Helpers ────────────────────────────────────────────────────────

export function minutesToTimeString(minutes: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ─── Single Field Score (BUG-004: used by enrichFieldValues for all field types) ──

export function computeSingleFieldScore(params: {
  field: SadhanaField;
  value: any;
  ashrayLevel: string;
  entryDate: string;
  residencyBucket: string;
}): { points: number; maxPoints: number } {
  const { field, value, ashrayLevel, entryDate, residencyBucket } = params;
  if (!field.contributesToScore) return { points: 0, maxPoints: 0 };

  const criteria = parseCriteria(field.criteria);
  const normalizedType = normalizeFieldType(field.fieldType, field.fieldKey);
  const options = parseOptions(field);

  if (isNRCriteria(criteria)) {
    const nrResult = calculateNRPoints(criteria, value, ashrayLevel, entryDate);
    if (nrResult.target === null) return { points: 0, maxPoints: 0 };
    return { points: nrResult.points, maxPoints: nrResult.maxPoints };
  }

  if ((normalizedType === 'radio' || normalizedType === 'dropdown')) {
    const max = options.length > 0 ? Math.max(...options.map(o => o.pointsValue), 0) : 0;
    if (value !== undefined && value !== null && value !== '') {
      const sel = options.find(opt => String(opt.storedValue) === String(value));
      const pts = sel ? sel.pointsValue : parseNumericValue(value);
      return { points: pts, maxPoints: max };
    }
    return { points: 0, maxPoints: max };
  }

  if (normalizedType === 'multiselect') {
    const max = options.reduce((sum, o) => sum + o.pointsValue, 0);
    if (Array.isArray(value) && value.length > 0) {
      let pts = 0;
      value.forEach((sv: any) => {
        const opt = options.find(o => String(o.storedValue) === String(sv));
        if (opt) pts += opt.pointsValue;
      });
      return { points: pts, maxPoints: max };
    }
    return { points: 0, maxPoints: max };
  }

  if (normalizedType === 'toggle') {
    const opts = parseOptions(field);
    if (opts.length >= 2) {
      const offPts = opts[0].pointsValue;  // first option = OFF/No state
      const onPts  = opts[1].pointsValue;  // second option = ON/Yes state
      // Penalty-only toggle: off is positive, on is negative (e.g. bath: No=+1, Yes=-1)
      // Treat as pure deduction — max is 0, off-state = 0 points (no bonus)
      if (offPts > 0 && onPts < 0) {
        return { points: value === true ? onPts : 0, maxPoints: 0 };
      }
      const pts = value === true ? onPts : offPts;
      const maxPts = Math.max(offPts, onPts);
      return { points: pts, maxPoints: maxPts };
    }
    const togglePts = getTogglePoints(field);
    const pts = value === true ? togglePts : 0;
    const max = togglePts > 0 ? togglePts : 0;
    return { points: pts, maxPoints: max };
  }

  if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
    const numericValue = parseNumericValue(value);
    return calculateResidentPoints(criteria, numericValue, residencyBucket);
  }

  return { points: 0, maxPoints: 0 };
}

// ─── Sick/OS Scoring Constants ────────────────────────────────────────────────
// Resident sick/OS: only rounds (max 4) + sp_reading (max 3) scored = max 7
// Server adds report_sending (1) → final max = 8
// NR sick/OS: only chanting (max 8) + reading (max 4) scored = max 12
// No normalization — raw scored values are used directly.

const SICK_OS_SCORED_KEYS_RESIDENT = new Set(['sp_reading', 'rounds', 'sp_reading_minutes', 'rounds_count']);
const SICK_OS_SCORED_KEYS_NR = new Set(['reading', 'chanting']);

// ─── Full Score Calculation ──────────────────────────────────────────────────

export function calculateTotalScore(params: {
  fields: SadhanaField[];
  values: Record<string, any>;
  ashrayLevel: string;
  entryDate: string;
  residencyBucket: string;
  isSickOrOs?: boolean;  // BUG-005
  isResident?: boolean;  // BUG-005
}): { totalScore: number; maxScore: number; scorePercent: number | null } {
  const { fields, values, ashrayLevel, entryDate, residencyBucket, isSickOrOs, isResident } = params;
  let total = 0;
  let max = 0;

  // BUG-005: when sick/OS, only score reading+chanting fields
  const scoredKeys = isSickOrOs
    ? (isResident ? SICK_OS_SCORED_KEYS_RESIDENT : SICK_OS_SCORED_KEYS_NR)
    : null;

  for (const field of fields) {
    if (!field.contributesToScore) continue;
    if (scoredKeys && !scoredKeys.has(field.fieldKey)) continue; // BUG-005: skip non-allowed

    const criteria = parseCriteria(field.criteria);
    const normalizedType = normalizeFieldType(field.fieldType, field.fieldKey);
    const rawValue = values[field.fieldKey];
    const options = parseOptions(field);

    // SAD-017: compute NR once (merged double call)
    if (isNRCriteria(criteria)) {
      const nrResult = calculateNRPoints(criteria, rawValue, ashrayLevel, entryDate);
      if (nrResult.target === null) continue; // not applicable for this ashray level
      total += nrResult.points;
      max += nrResult.maxPoints;
      continue;
    }

    // ── Calculate field points ──
    let fieldPoints = 0;
    let fieldMax = 0;

    if ((normalizedType === 'radio' || normalizedType === 'dropdown') && rawValue !== undefined && rawValue !== null && rawValue !== '') {
      const selectedOption = options.find(opt => String(opt.storedValue) === String(rawValue));
      fieldPoints = selectedOption ? selectedOption.pointsValue : parseNumericValue(rawValue);
      fieldMax = options.length > 0 ? Math.max(...options.map(o => o.pointsValue), 0) : 0;
    } else if (normalizedType === 'multiselect' && Array.isArray(rawValue) && rawValue.length > 0) {
      rawValue.forEach((sv: any) => {
        const opt = options.find(o => String(o.storedValue) === String(sv));
        if (opt) fieldPoints += opt.pointsValue;
      });
      fieldMax = options.reduce((sum, o) => sum + o.pointsValue, 0);
    } else if (normalizedType === 'toggle') {
      const opts = parseOptions(field);
      if (opts.length >= 2) {
        const offPts = opts[0].pointsValue;
        const onPts  = opts[1].pointsValue;
        // Penalty-only toggle: off is positive, on is negative — max = 0, off = 0
        if (offPts > 0 && onPts < 0) {
          fieldPoints = rawValue === true ? onPts : 0;
          fieldMax = 0;
        } else {
          fieldPoints = rawValue === true ? onPts : offPts;
          fieldMax = Math.max(offPts, onPts);
        }
      } else {
        const togglePts = getTogglePoints(field);
        if (rawValue === true) fieldPoints = togglePts;
        fieldMax = togglePts > 0 ? togglePts : 0;
      }
    } else if (criteria && typeof criteria === 'object' && !Array.isArray(criteria)) {
      const numericValue = parseNumericValue(rawValue);
      const result = calculateResidentPoints(criteria, numericValue, residencyBucket);
      fieldPoints = result.points;
      fieldMax = result.maxPoints;
    } else {
      // Non-NR radio/dropdown max without value
      if ((normalizedType === 'radio' || normalizedType === 'dropdown') && options.length > 0) {
        fieldMax = Math.max(...options.map(o => o.pointsValue), 0);
      } else if (normalizedType === 'multiselect' && options.length > 0) {
        fieldMax = options.reduce((sum, o) => sum + o.pointsValue, 0);
      }
    }

    total += fieldPoints;
    max += fieldMax;
  }

  // Sick/OS: no normalization — return raw scored values.
  // Resident sick/OS base max = 7 (rounds 4 + spReading 3); server adds report_sending (+1) → final max 8.
  // NR sick/OS base max = 12 (chanting 8 + reading 4); no report_sending for NR.

  const scorePercent = max > 0 ? Math.round((total / max) * 100) : null;
  return { totalScore: total, maxScore: max, scorePercent };
}

// ─── Score Color Helpers (single source — import these everywhere) ────────────

import { THRESHOLDS } from '@/types/enums';

function getThresholds(isResident: boolean) {
  return isResident ? THRESHOLDS.resident : THRESHOLDS.nonResident;
}

/**
 * Returns a Tailwind text color class based on score percentage.
 * Residents: ≥95% green, ≥85% yellow, <85% red
 * Non-residents: ≥75% green, ≥50% yellow, <50% red
 */
export function scoreColor(pct: number | null | undefined, isResident = false): string {
  if (pct == null) return 'text-muted-foreground';
  const { healthy, moderate } = getThresholds(isResident);
  if (pct >= healthy * 100) return 'text-green-600';
  if (pct >= moderate * 100) return 'text-yellow-600';
  return 'text-red-500';
}

/**
 * Returns Tailwind background + text badge classes based on score percentage.
 */
export function scoreBg(pct: number | null | undefined, isResident = false): string {
  if (pct == null) return 'bg-muted text-muted-foreground';
  const { healthy, moderate } = getThresholds(isResident);
  if (pct >= healthy * 100) return 'bg-green-100 text-green-800';
  if (pct >= moderate * 100) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

/**
 * Returns a Tailwind background color class for progress bars/charts.
 */
export function scoreBarColor(pct: number | null | undefined, isResident = false): string {
  if (pct == null) return 'bg-muted';
  const { healthy, moderate } = getThresholds(isResident);
  if (pct >= healthy * 100) return 'bg-green-500';
  if (pct >= moderate * 100) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ─── Field Visibility Filter ─────────────────────────────────────────────────

export function isFieldVisibleForUser(
  field: SadhanaField,
  ashrayLevel: string,
  entryDate: string
): boolean {
  const criteria = parseCriteria(field.criteria);
  if (!isNRCriteria(criteria)) return true;
  const { target } = calculateNRPoints(criteria, null, ashrayLevel, entryDate);
  return target !== null;
}
