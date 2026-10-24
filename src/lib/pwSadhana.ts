/** Personalized Prabhupada World sadhana. FOLK scoring is unchanged.
 * Days saved before this rubric keep the chanting-and-reading percentage. */

import { DEFAULT_PW_TIME_ZONE, normalizeSadhanaTimeZone, pwTimelySubmissionPoints } from './pwSubmissionTiming';

export const PW_TOTAL_POINTS = 60;
export const PW_SUBMISSION_CUTOFF = '14:00';

export const PW_FIELDS = [
  { key: 'wakeUp', label: 'Wake-up Time', maxPoints: 4, waivable: true },
  { key: 'sleep', label: 'Sleep Time', maxPoints: 4, waivable: true },
  { key: 'chanting', label: 'Chanting Rounds', maxPoints: 16, waivable: true },
  { key: 'reading', label: 'Reading Time', maxPoints: 8, waivable: false },
  { key: 'hearing', label: 'Hearing Time', maxPoints: 8, waivable: false },
  { key: 'submitted', label: 'Sadhana Submitted on Time', maxPoints: 2, waivable: false },
  { key: 'seva', label: 'Seva / Service', maxPoints: 8, waivable: false },
  { key: 'bvAttendance', label: 'Bhakti Vriksha Attendance', maxPoints: 10, waivable: false },
] as const;

export type PwFieldKey = (typeof PW_FIELDS)[number]['key'];
export type PwWaivableKey = 'wakeUp' | 'sleep' | 'chanting';

export interface PwTargets {
  wakeUp: string | null;
  sleep: string | null;
  chanting: number | null;
  readingMin: number | null;
  hearingMin: number | null;
  sevaMin: number | null;
}

export interface PwFieldScore {
  key: PwFieldKey;
  label: string;
  maxPoints: number;
  points: number | null;
  applicable: boolean;
  waived: boolean;
}

export interface PwScoreResult {
  fields: PwFieldScore[];
  earned: number;
  applicableMax: number;
  scorePercent: number | null;
}

export function emptyPwTargets(): PwTargets {
  return { wakeUp: null, sleep: null, chanting: null, readingMin: null, hearingMin: null, sevaMin: null };
}

export function pwTarget(value: unknown): number | null {
  if (value == null || value === '') return null;
  const target = Number(value);
  if (!Number.isFinite(target) || target <= 0) return null;
  return Math.round(target);
}

export function pwTime(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function minutesOfDay(value: unknown): number | null {
  const time = pwTime(value);
  if (!time) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
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

export function istClock(iso: string): { date: string; minutes: number } | null {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const read = (type: string) => parts.find(part => part.type === type)?.value || '';
  const hour = Number(read('hour'));
  const minute = Number(read('minute'));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    minutes: (hour === 24 ? 0 : hour) * 60 + minute,
  };
}

function numberOrZero(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

function bandPoints(done: number, target: number | null): number | null {
  if (target == null) return null;
  const ratio = done / target;
  if (ratio >= 1) return 8;
  if (ratio > 0.75) return 6;
  if (ratio > 0.5) return 4;
  if (ratio >= 0.25) return 2;
  return 0;
}

function attendancePoints(attended: number | null, session: number | null): number | null {
  if (session == null || session <= 0 || attended == null) return null;
  const ratio = Math.max(0, attended) / session;
  if (ratio > 0.5) return 10;
  if (ratio >= 0.25) return 5;
  return 0;
}

/** Positive when the reported time is after the target. Sleep wraps past midnight. */
export function minutesLate(actual: unknown, target: unknown, wrapsPastMidnight: boolean): number | null {
  const reported = minutesOfDay(actual);
  const assigned = minutesOfDay(target);
  if (reported == null || assigned == null) return null;
  let late = reported - assigned;
  if (wrapsPastMidnight && late < -12 * 60) late += 24 * 60;
  return late;
}

function timePoints(actual: unknown, target: string | null, wrapsPastMidnight: boolean): number | null {
  if (!target) return null;
  if (!pwTime(actual)) return 0;
  const late = minutesLate(actual, target, wrapsPastMidnight);
  if (late == null) return 0;
  if (late <= 0) return 4;
  if (late <= 60) return 2;
  return 0;
}

export function submissionPoints(entryDate: string, submittedAt: string | null | undefined, _deadline = '10:00', timeZone = DEFAULT_PW_TIME_ZONE): number {
  return pwTimelySubmissionPoints(entryDate, submittedAt, timeZone);
}

function waiveReason(value: unknown): string {
  return String(value ?? '').trim();
}

function fieldResult(key: PwFieldKey, points: number | null, waived = false): PwFieldScore {
  const def = PW_FIELDS.find(field => field.key === key)!;
  const applicable = points != null;
  return {
    key,
    label: def.label,
    maxPoints: def.maxPoints,
    points: applicable ? points : null,
    applicable,
    waived,
  };
}

export function scorePwSadhanaV2(input: {
  wakeUp?: unknown;
  sleep?: unknown;
  chanting?: unknown;
  reading?: unknown;
  hearing?: unknown;
  seva?: unknown;
  bvAttendedMinutes?: unknown;
  bvSessionMinutes?: unknown;
  submittedAt?: string | null;
  entryDate: string;
  submissionDeadline?: string | null;
  timeZone?: string;
  waiveWakeUp?: unknown;
  waiveWakeUpReason?: unknown;
  waiveSleep?: unknown;
  waiveSleepReason?: unknown;
  waiveChanting?: unknown;
  waiveChantingReason?: unknown;
  targets: PwTargets;
}): PwScoreResult {
  const targets = input.targets;
  const wakeWaived = input.waiveWakeUp === true && waiveReason(input.waiveWakeUpReason).length > 0;
  const sleepWaived = input.waiveSleep === true && waiveReason(input.waiveSleepReason).length > 0;
  const chantWaived = input.waiveChanting === true && waiveReason(input.waiveChantingReason).length > 0;
  const chantingTarget = pwTarget(targets.chanting);
  const chantingDone = numberOrZero(input.chanting);
  const fields: PwFieldScore[] = [
    fieldResult('wakeUp', wakeWaived ? 4 : timePoints(input.wakeUp, pwTime(targets.wakeUp), false), wakeWaived),
    fieldResult('sleep', sleepWaived ? 4 : timePoints(input.sleep, pwTime(targets.sleep), true), sleepWaived),
    fieldResult('chanting', chantWaived ? 16 : (chantingTarget == null ? null : Math.round(16 * Math.min(1, chantingDone / chantingTarget))), chantWaived),
    fieldResult('reading', bandPoints(numberOrZero(input.reading), pwTarget(targets.readingMin))),
    fieldResult('hearing', bandPoints(numberOrZero(input.hearing), pwTarget(targets.hearingMin))),
    fieldResult('submitted', submissionPoints(input.entryDate, input.submittedAt, pwTime(input.submissionDeadline) || '10:00', input.timeZone)),
    fieldResult('seva', bandPoints(numberOrZero(input.seva), pwTarget(targets.sevaMin))),
    fieldResult('bvAttendance', attendancePoints(
      input.bvAttendedMinutes == null || input.bvAttendedMinutes === '' ? null : numberOrZero(input.bvAttendedMinutes),
      input.bvSessionMinutes == null || input.bvSessionMinutes === '' ? null : pwTarget(input.bvSessionMinutes),
    )),
  ];
  const applicable = fields.filter(field => field.applicable && field.points != null);
  let earned = applicable.reduce((sum, field) => sum + (field.points || 0), 0);
  const applicableMax = applicable.reduce((sum, field) => sum + field.maxPoints, 0);
  // No targets means only on-time submission is scored. An all-zero day is 0%,
  // not 2/2 from submitting the empty report on time.
  const onlySubmission = applicable.length > 0 && applicable.every(field => field.key === 'submitted');
  if (onlySubmission && reportedAmountsAreZero(input)) {
    const submitted = fields.find(field => field.key === 'submitted');
    if (submitted) submitted.points = 0;
    earned = 0;
  }
  return {
    fields,
    earned,
    applicableMax,
    scorePercent: applicableMax > 0 ? Math.round((earned / applicableMax) * 100) : null,
  };
}

function reportedAmountsAreZero(input: {
  chanting?: unknown;
  reading?: unknown;
  hearing?: unknown;
  seva?: unknown;
  bvAttendedMinutes?: unknown;
}): boolean {
  if ([input.chanting, input.reading, input.hearing, input.seva].some(value => numberOrZero(value) > 0)) return false;
  if (input.bvAttendedMinutes != null && input.bvAttendedMinutes !== '' && numberOrZero(input.bvAttendedMinutes) > 0) return false;
  return true;
}

function parseStored(fieldValuesJson: unknown): Record<string, any> {
  if (typeof fieldValuesJson === 'string') {
    try { return JSON.parse(fieldValuesJson) || {}; } catch { return {}; }
  }
  if (fieldValuesJson && typeof fieldValuesJson === 'object') return fieldValuesJson as Record<string, any>;
  return {};
}

export interface PwStoredScore {
  hasSnapshot: boolean;
  version: 0 | 1 | 2;
  chanting: number;
  reading: number;
  scorePercent: number | null;
  earned: number | null;
  applicableMax: number | null;
  fieldPoints: Partial<Record<PwFieldKey, number | null>> | null;
}

/** Percent stored with a submitted day. Days from before a target was assigned have no percentage. */
export function pwScoreFromFieldValues(fieldValuesJson: unknown): PwStoredScore {
  const stored = parseStored(fieldValuesJson);
  const meta = stored._meta && typeof stored._meta === 'object' ? stored._meta : {};
  const chanting = Number(stored.chanting ?? stored.rounds ?? 0) || 0;
  const reading = Number(stored.reading ?? 0) || 0;
  const legacy = !!meta && ('pwChantingTarget' in meta || 'pwReadingTarget' in meta);
  if (meta.pwVersion === 2) {
    const fieldPoints = meta.pwFields && typeof meta.pwFields === 'object' ? meta.pwFields : null;
    const scorePercent = meta.scorePercent == null ? null : Number(meta.scorePercent);
    return {
      hasSnapshot: true,
      version: 2,
      chanting,
      reading,
      scorePercent: Number.isFinite(scorePercent) ? scorePercent : null,
      earned: meta.pwEarned == null ? null : Number(meta.pwEarned),
      applicableMax: meta.pwApplicableMax == null ? null : Number(meta.pwApplicableMax),
      fieldPoints,
    };
  }
  if (!legacy) {
    return { hasSnapshot: false, version: 0, chanting, reading, scorePercent: null, earned: null, applicableMax: null, fieldPoints: null };
  }
  const scored = scorePwSadhana({
    chanting,
    reading,
    chantingTarget: pwTarget(meta.pwChantingTarget),
    readingTarget: pwTarget(meta.pwReadingTarget),
  });
  return {
    hasSnapshot: true,
    version: 1,
    chanting,
    reading,
    scorePercent: scored.scorePercent,
    earned: null,
    applicableMax: null,
    fieldPoints: null,
  };
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

export function readPwTargets(value: unknown): PwTargets {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    wakeUp: pwTime(stored.wakeUp),
    sleep: pwTime(stored.sleep),
    chanting: pwTarget(stored.chanting),
    readingMin: pwTarget(stored.readingMin),
    hearingMin: pwTarget(stored.hearingMin),
    sevaMin: pwTarget(stored.sevaMin),
  };
}

export function withLegacyTargets(targets: PwTargets, user: { pwChantingTarget?: unknown; pwReadingTarget?: unknown } | null | undefined): PwTargets {
  return {
    ...targets,
    chanting: targets.chanting ?? pwTarget(user?.pwChantingTarget),
    readingMin: targets.readingMin ?? pwTarget(user?.pwReadingTarget),
  };
}

export function pwSnapshotMeta(input: {
  result: PwScoreResult;
  targets: PwTargets;
  source: string;
  deadline: string;
  timeZone?: string;
  existing?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    ...(input.existing || {}),
    pwVersion: 2,
    pwTargets: input.targets,
    pwTargetSource: input.source,
    pwSubmissionDeadline: input.deadline,
    pwTimeZone: normalizeSadhanaTimeZone(input.timeZone) || normalizeSadhanaTimeZone(input.existing?.pwTimeZone) || DEFAULT_PW_TIME_ZONE,
    pwFields: Object.fromEntries(input.result.fields.map(field => [field.key, field.points])),
    pwEarned: input.result.earned,
    pwApplicableMax: input.result.applicableMax,
    scorePercent: input.result.scorePercent,
    pwChantingTarget: input.targets.chanting,
    pwReadingTarget: input.targets.readingMin,
  };
}

export function scoreStoredPwDay(stored: Record<string, any>, options: {
  targets: PwTargets;
  source: string;
  deadline: string;
  submittedAt: string | null;
  entryDate: string;
  timeZone?: string;
}): { result: PwScoreResult; meta: Record<string, unknown> } {
  const timeZone = normalizeSadhanaTimeZone(options.timeZone) || normalizeSadhanaTimeZone(stored._meta?.pwTimeZone) || DEFAULT_PW_TIME_ZONE;
  const result = scorePwSadhanaV2({
    wakeUp: stored.wakeUp,
    sleep: stored.sleep,
    chanting: stored.chanting ?? stored.rounds,
    reading: stored.reading,
    hearing: stored.hearing,
    seva: stored.seva,
    bvAttendedMinutes: stored.bvAttendedMinutes,
    bvSessionMinutes: stored.bvSessionMinutes,
    submittedAt: options.submittedAt,
    entryDate: options.entryDate,
    submissionDeadline: options.deadline,
    timeZone,
    waiveWakeUp: stored.waiveWakeUp,
    waiveWakeUpReason: stored.waiveWakeUpReason,
    waiveSleep: stored.waiveSleep,
    waiveSleepReason: stored.waiveSleepReason,
    waiveChanting: stored.waiveChanting,
    waiveChantingReason: stored.waiveChantingReason,
    targets: options.targets,
  });
  return {
    result,
    meta: pwSnapshotMeta({
      result,
      targets: options.targets,
      source: options.source,
      deadline: options.deadline,
      timeZone,
      existing: stored._meta,
    }),
  };
}

export function pwDetailRows(fieldValuesJson: unknown): Array<{
  fieldKey: string;
  fieldLabel: string;
  displayValue: string;
  points?: number;
  maxPoints?: number;
}> | null {
  const scored = pwScoreFromFieldValues(fieldValuesJson);
  if (scored.version !== 2) return null;
  const stored = parseStored(fieldValuesJson);
  const rows: Array<{ fieldKey: string; fieldLabel: string; displayValue: string; points?: number; maxPoints?: number }> = PW_FIELDS.map(field => {
    const points = scored.fieldPoints?.[field.key];
    let display = 'Not assigned';
    if (field.key === 'wakeUp') display = pwTime(stored.wakeUp) || (stored.waiveWakeUp ? 'Waived' : '—');
    else if (field.key === 'sleep') display = pwTime(stored.sleep) || (stored.waiveSleep ? 'Waived' : '—');
    else if (field.key === 'chanting') display = stored.waiveChanting ? `Waived (${numberOrZero(stored.chanting)} rounds)` : `${numberOrZero(stored.chanting)} rounds`;
    else if (field.key === 'reading') display = `${numberOrZero(stored.reading)} min`;
    else if (field.key === 'hearing') display = `${numberOrZero(stored.hearing)} min${stored.heardSbBefore1030 ? ' · SB class before 10:30 AM' : ''}`;
    else if (field.key === 'submitted') display = points == null ? '—' : `${points} pts`;
    else if (field.key === 'seva') display = `${numberOrZero(stored.seva)} min`;
    else if (field.key === 'bvAttendance') {
      display = stored.bvSessionMinutes == null
        ? 'Not recorded'
        : `${numberOrZero(stored.bvAttendedMinutes)} / ${numberOrZero(stored.bvSessionMinutes)} min`;
    }
    if (points == null) display = field.key === 'bvAttendance' ? 'Not recorded' : 'Not assigned';
    return {
      fieldKey: field.key,
      fieldLabel: field.label,
      displayValue: display,
      points: points == null ? undefined : points,
      maxPoints: points == null ? undefined : field.maxPoints,
    };
  });
  for (const [key, label] of [['preaching_raw', 'Preaching (min)'], ['distribution_raw', 'Books Distributed']] as const) {
    if (stored[key] == null || stored[key] === '') continue;
    rows.push({ fieldKey: key, fieldLabel: label, displayValue: String(stored[key]), points: undefined, maxPoints: undefined });
  }
  return rows;
}

const SOURCE_LABEL: Record<string, string> = {
  rgf: 'your RGF',
  admin: 'your admin',
  mentor: 'your sadhana mentor',
  ashraya: 'your Ashraya level',
};

export function pwFormFields(targets: PwTargets, source: string) {
  const by = SOURCE_LABEL[source] || 'your guide';
  const targetText = (label: string, value: string | number | null, unit = '') =>
    value == null ? `${label} is not assigned yet` : `${label} set by ${by}: ${value}${unit}`;
  const fields: Array<{
    fieldKey: string; fieldLabel: string; fieldType: string; isRequired: boolean;
    helpText?: string; minValue?: number; maxValue?: number;
  }> = [
    { fieldKey: 'wakeUp', fieldLabel: 'Wake-up time', fieldType: 'time', isRequired: true, helpText: targetText('Wake-up', pwTime(targets.wakeUp)), maxValue: 0 },
    { fieldKey: 'waiveWakeUp', fieldLabel: 'Request waive-off for wake-up', fieldType: 'toggle', isRequired: false },
    { fieldKey: 'waiveWakeUpReason', fieldLabel: 'Wake-up waive-off reason', fieldType: 'text', isRequired: false },
    { fieldKey: 'sleep', fieldLabel: "Previous night's sleep time", fieldType: 'time', isRequired: true, helpText: `Enter when you went to sleep the night before the Sadhana date, even when submitting the next morning. ${targetText('Sleep', pwTime(targets.sleep))}`, maxValue: 0 },
    { fieldKey: 'waiveSleep', fieldLabel: 'Request waive-off for sleep', fieldType: 'toggle', isRequired: false },
    { fieldKey: 'waiveSleepReason', fieldLabel: 'Sleep waive-off reason', fieldType: 'text', isRequired: false },
    { fieldKey: 'chanting', fieldLabel: 'Chanting (rounds)', fieldType: 'number', isRequired: true, helpText: targetText('Chanting', pwTarget(targets.chanting), ' rounds'), minValue: 0, maxValue: 192 },
    { fieldKey: 'waiveChanting', fieldLabel: 'Request waive-off for chanting', fieldType: 'toggle', isRequired: false },
    { fieldKey: 'waiveChantingReason', fieldLabel: 'Chanting waive-off reason', fieldType: 'text', isRequired: false },
    { fieldKey: 'reading', fieldLabel: 'Reading (minutes)', fieldType: 'number', isRequired: true, helpText: targetText('Reading', pwTarget(targets.readingMin), ' min'), minValue: 0, maxValue: 1440 },
    { fieldKey: 'hearing', fieldLabel: 'Hearing (minutes)', fieldType: 'number', isRequired: true, helpText: targetText('Hearing', pwTarget(targets.hearingMin), ' min'), minValue: 0, maxValue: 1440 },
    { fieldKey: 'heardSbBefore1030', fieldLabel: 'Heard SB class before 10:30 AM', fieldType: 'toggle', isRequired: false, helpText: 'Recorded with the day. It does not change the points.' },
    { fieldKey: 'seva', fieldLabel: 'Seva (minutes)', fieldType: 'number', isRequired: true, helpText: targetText('Seva', pwTarget(targets.sevaMin), ' min'), minValue: 0, maxValue: 1440 },
  ];
  return fields.map((field, index) => ({
    fieldId: `pw_${field.fieldKey}`,
    fieldKey: field.fieldKey,
    fieldLabel: field.fieldLabel,
    fieldType: field.fieldType,
    displayOrder: index + 1,
    isRequired: field.isRequired,
    contributesToScore: false,
    maxPoints: 0,
    minValue: field.minValue ?? 0,
    maxValue: field.maxValue ?? 0,
    group: 'Sadhana',
    helpText: field.helpText || null,
    contextTag: null,
    options: [],
    criteria: null,
  }));
}
