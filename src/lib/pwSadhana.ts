/** Personalized Prabhupada World sadhana. FOLK scoring is unchanged. */

export function pwTarget(value: unknown): number | null {
  if (value == null || value === '') return null;
  const target = Number(value);
  if (!Number.isFinite(target) || target <= 0) return null;
  return Math.round(target);
}

/** Actual divided by the assigned target, never above 100. No target means no percentage. */
export function pwFieldPercent(actual: number, target: number | null): number | null {
  if (target == null) return null;
  const done = Number.isFinite(actual) ? Math.max(0, actual) : 0;
  return Math.min(100, Math.round((done / target) * 100));
}

export function pwOverallPercent(parts: Array<number | null>): number | null {
  const scored = parts.filter((part): part is number => part != null);
  if (!scored.length) return null;
  return Math.round(scored.reduce((sum, part) => sum + part, 0) / scored.length);
}

export function formatPwProgress(actual: number | null | undefined, target: number | null): string {
  if (actual == null || Number.isNaN(Number(actual))) return '—';
  const rounded = Math.round(Number(actual) * 10) / 10;
  const shown = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return target == null ? shown : `${shown}/${target}`;
}

export function scorePwSadhana(input: {
  chanting: number;
  reading: number;
  chantingTarget: number | null;
  readingTarget: number | null;
}): { chantingPercent: number | null; readingPercent: number | null; scorePercent: number | null } {
  const chantingPercent = pwFieldPercent(input.chanting, input.chantingTarget);
  const readingPercent = pwFieldPercent(input.reading, input.readingTarget);
  return {
    chantingPercent,
    readingPercent,
    scorePercent: pwOverallPercent([chantingPercent, readingPercent]),
  };
}
