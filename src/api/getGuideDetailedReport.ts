import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, SadhanaEntries, BvGroups, BvGroupMembers } from 'zite-integrations-backend-sdk';
import { requireGuideRole, normalizeAshrayLevel } from '../lib/userUtils';
import { NON_RESIDENT_FIELDS } from '../config/sadhanaFields';
import { computeStreak, getTodayIST, daysAgo } from '../lib/streakUtils';

const USER_FIELDS = ['id', 'userId', 'fullName', 'phone', 'ashrayLevel', 'residency', 'residencyApproved', 'temporaryResidencyEnabled', 'temporaryResidency', 'residencyJoinDate', 'scholarSince', 'residentSince', 'currentStreak', 'lastStreakUpdatedAt', 'guide'];
const ENTRY_FIELDS = [
  'id', 'user', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt', 'templateMode',
  'roundsCount', 'roundsPoints', 'sbPoints', 'maNaGvPoints', 'quotesTulasiPoints', 'japaVisiblePoints',
  'cleanlinessPoints', 'reportSendingPoints', 'dailyServicePoints', 'sleepQualityPoints',
  'spReadingMinutes', 'spReadingPoints', 'japaFinishTime', 'sleepMinutes', 'studyMinutes', 'preachingMinutes',
  'booksDistributed', 'fieldValuesJson',
];

function parseFieldValues(json: string | null | undefined): Record<string, any> {
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

/** Get reportSendingPoints for an entry.
 *  RANK-FIX: Always trusts the DB-stored reportSendingPoints column as source of truth.
 *  Recomputing live from submittedAt introduces IST timezone drift that causes rank shifts.
 *  Falls back to live-compute only for old entries where the DB column is null/missing. */
function getReportSendingPts(entry: any): number {
  // Trust DB column first — set correctly at submission time
  const dbVal = entry.reportSendingPoints;
  if (dbVal != null) return Number(dbVal);

  // Fallback: live recompute for old entries lacking the column
  const submittedAt = entry.submittedAt ? String(entry.submittedAt) : null;
  const entryDate = String(entry.entryDate || '').split('T')[0];
  if (!submittedAt || !entryDate) return 0;

  const templateMode = String(entry.templateMode || '');
  const isResident = templateMode.toUpperCase().includes('RESIDENT') &&
    !templateMode.toUpperCase().includes('NON_RESIDENT');

  if (isResident) {
    // Compare submittedAt IST date with entryDate
    const submittedIST = new Date(new Date(submittedAt).getTime() + 5.5 * 60 * 60 * 1000);
    const submittedDateIST = submittedIST.toISOString().split('T')[0];
    return submittedDateIST === entryDate ? 1 : 0;
  } else {
    // NR: day-delay rule (UTC midnight comparison)
    const subD = new Date(submittedAt);
    subD.setHours(0, 0, 0, 0);
    const entryD = new Date(entryDate + 'T00:00:00');
    const dayDelay = Math.max(0, Math.round((subD.getTime() - entryD.getTime()) / 86400000));
    return Math.max(0, 4 - dayDelay * 2);
  }
}

function minutesToHHMM(mins: number): string {
  if (isNaN(mins) || mins < 0) return '';
  const rounded = Math.round(mins); // round first to avoid floating-point artifacts
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseHHMMlocal(timeStr: string): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1]); const m = parseInt(ampm[2]);
    if (ampm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (ampm[3].toUpperCase() === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function computeDayDelay(entry: any): number {
  if (!entry.submittedAt || !entry.entryDate) return 999;
  const subD = new Date(String(entry.submittedAt));
  subD.setHours(0, 0, 0, 0);
  const entryD = new Date(String(entry.entryDate).slice(0, 10) + 'T00:00:00');
  return Math.max(0, Math.round((subD.getTime() - entryD.getTime()) / 86400000));
}

// NR color computation based on level-specific criteria
const NR_CRITERIA_MAP = Object.fromEntries(
  NON_RESIDENT_FIELDS.filter(f => f.criteria).map(f => [f.fieldKey, f.criteria as any])
);

function computeNRColors(
  fScores: Record<string, any>,
  ashrayLevel: string | null | undefined,
): Record<string, string | null> {
  const colors: Record<string, string | null> = {};
  if (!ashrayLevel) return colors;
  const level = normalizeAshrayLevel(ashrayLevel);
  const levelU = level.replace(/ /g, '_');

  for (const key of Object.keys(NR_CRITERIA_MAP)) {
    const crit = NR_CRITERIA_MAP[key];
    if (!crit?.levels) continue;
    const target = crit.levels[level] ?? crit.levels[levelU];
    if (!target || target === '-') { colors[key] = null; continue; }
    if (typeof target === 'string' && target.includes('leaderboard')) { colors[key] = null; continue; }
    if (target === 'enabled') { colors[key] = null; continue; }

    const rule = ((crit.penalty_rule || '') as string).toLowerCase();
    const raw = fScores[key];

    // Pro rata: compare actual vs target
    if (rule.includes('pro rata')) {
      if (raw == null || raw === '') { colors[key] = null; continue; }
      const targetNum = parseFloat(String(target).replace(/[^0-9.]/g, '')) || 0;
      if (targetNum === 0) { colors[key] = null; continue; }
      if (typeof raw === 'string') {
        if (raw === 'Yes') { colors[key] = 'green'; continue; }
        if (raw === 'No') { colors[key] = 'red'; continue; }
        const dm = raw.match(/(\d+)\/(\d+)/);
        if (dm) { const r = parseInt(dm[1]) / parseInt(dm[2]); colors[key] = r >= 0.75 ? 'green' : r >= 0.5 ? 'amber' : 'red'; continue; }
      }
      const actual = parseFloat(String(raw)) || 0;
      const ratio = actual / targetNum;
      colors[key] = ratio >= 1 ? 'green' : ratio >= 0.5 ? 'amber' : 'red';
      continue;
    }

    // Time delay: wake/sleep
    if (rule.includes('15 min')) {
      if (!raw) { colors[key] = null; continue; }
      const tgtMins = parseHHMMlocal(String(target));
      const actMins = parseHHMMlocal(String(raw));
      if (actMins === 0) { colors[key] = null; continue; }
      const delay = Math.max(0, actMins - tgtMins);
      colors[key] = delay < 15 ? 'green' : delay < 45 ? 'amber' : 'red';
      continue;
    }

    // Day delay: fillingSameDay
    if (rule.includes('day')) {
      if (typeof raw === 'string') {
        if (raw === 'Yes') { colors[key] = 'green'; continue; }
        if (raw === 'No') { colors[key] = 'red'; continue; }
        const dm = raw.match(/(\d+)\/(\d+)/);
        if (dm) { const r = parseInt(dm[1]) / parseInt(dm[2]); colors[key] = r >= 0.75 ? 'green' : r >= 0.5 ? 'amber' : 'red'; continue; }
      }
      colors[key] = null;
    }
  }
  return colors;
}

/** Compute which NR fields are N/A for a given ashray level */
function computeNRNAFields(ashrayLevel: string | null | undefined): Record<string, boolean> {
  if (!ashrayLevel) return {};
  const level = normalizeAshrayLevel(ashrayLevel);
  const isNA = ['Jigyasa', 'Shraddhavan', 'Gauranga Sabha'].includes(level);
  return {
    wakeUptime: isNA,
    sleepTime: isNA,
    fillingSameDay: isNA,
    seva: isNA,
    bhaktiVriksha: isNA,
  };
}

/**
 * Compute which NR fields are "leaderboard only" (tracked but NOT counted in score/percent).
 * These should display with neutral styling — no green/amber/red background.
 *
 * wakeUptime/sleepTime: 'enabled' target for Sevak/Sadhaka — no scoring target
 * Seva: leaderboard for Sevak/Sadhaka (scored for Upasaka+)
 * BV: leaderboard for Sevak/Sadhaka/Upasaka (scored for Caranashraya+)
 */
function computeNRLeaderboardFields(ashrayLevel: string | null | undefined): Record<string, boolean> {
  if (!ashrayLevel) return {};
  const level = normalizeAshrayLevel(ashrayLevel);
  return {
    wakeUptime:    ['Sevak', 'Sadhaka'].includes(level),
    sleepTime:     ['Sevak', 'Sadhaka'].includes(level),
    seva:          ['Sevak', 'Sadhaka'].includes(level),
    bhaktiVriksha: ['Sevak', 'Sadhaka', 'Upasaka'].includes(level),
  };
}

function numAvg(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v != null && !isNaN(v));
  if (valid.length === 0) return null;
  // Round to max 2 decimal places to prevent floating-point artifacts (e.g. 20.799999...)
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 100) / 100;
}

/** Integer-only average — for fields where fractions make no sense (minutes, book counts) */
function numAvgInt(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v != null && !isNaN(v));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

const FIELD_DEFS = [
  // Resident fields
  { key: 'ma_na_gv',         shortLabel: 'MA/GV',  maxPoints: 3,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'quotes_tulasi',    shortLabel: 'Q+T',    maxPoints: 1,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'japa_visible',     shortLabel: 'JapaV',  maxPoints: 2,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'sb',               shortLabel: 'SB',     maxPoints: 2,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'cleanliness',      shortLabel: 'Clean',  maxPoints: 1,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'report_sending',   shortLabel: 'FillDay', maxPoints: 1,   isScoring: true,  forResident: true,  forNR: false },
  { key: 'daily_service',    shortLabel: 'Svc',    maxPoints: 2,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'rounds',           shortLabel: 'Rounds', maxPoints: 4,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'sp_reading',       shortLabel: 'Read',   maxPoints: 3,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'sleep_quality',    shortLabel: 'SleepQ', maxPoints: 1,    isScoring: true,  forResident: true,  forNR: false },
  { key: 'japa_finish_time', shortLabel: 'JapaT',  maxPoints: null, isScoring: false, forResident: true,  forNR: false },
  { key: 'sleep_minutes',    shortLabel: 'Sleep',  maxPoints: null, isScoring: false, forResident: true,  forNR: false },
  { key: 'study_minutes',    shortLabel: 'Study',  maxPoints: null, isScoring: false, forResident: true,  forNR: false },
  { key: 'preaching_raw',    shortLabel: 'Preach', maxPoints: null, isScoring: false, forResident: true,  forNR: false },
  { key: 'distribution_raw', shortLabel: 'Books',  maxPoints: null, isScoring: false, forResident: true,  forNR: false },
  // NR fields — ordered to match the NR sadhana form (display_order 1–8 + informational)
  // Source of truth: src/config/sadhanaFields.ts → NON_RESIDENT_FIELDS
  { key: 'wakeUptime',     shortLabel: 'WakeUp', maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  }, // d/o 1: scored Upasaka+
  { key: 'sleepTime',      shortLabel: 'SleepT', maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  }, // d/o 2: scored Upasaka+
  { key: 'chanting',       shortLabel: 'Rounds', maxPoints: 8,    isScoring: true,  forResident: false, forNR: true  }, // d/o 3
  { key: 'reading',        shortLabel: 'Read',   maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  }, // d/o 4
  { key: 'hearing',        shortLabel: 'Hear',   maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  }, // d/o 5
  { key: 'fillingSameDay', shortLabel: 'OnTime', maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  }, // d/o 6: scored Sevak+
  // d/o 7: Seva — scored (4pts) for Upasaka+; leaderboard-only for Sevak/Sadhaka; N/A otherwise
  { key: 'seva',           shortLabel: 'Seva',   maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  },
  // d/o 8: BV — scored (4pts) for Caranashraya+; leaderboard-only for Sevak/Sadhaka/Upasaka; N/A otherwise
  { key: 'bhaktiVriksha',  shortLabel: 'BV',     maxPoints: 4,    isScoring: true,  forResident: false, forNR: true  },
  // d/o 9-10: NR informational fields (no scoring)
  { key: 'nr_preaching',   shortLabel: 'Preach', maxPoints: null, isScoring: false, forResident: false, forNR: true  },
  { key: 'nr_books',       shortLabel: 'Books',  maxPoints: null, isScoring: false, forResident: false, forNR: true  },
];

function aggregateEntries(entries: any[], isResident: boolean, ashrayLevel?: string | null) {
  if (entries.length === 0) {
    return { fieldScores: {}, fieldRawValues: {}, totalScore: null, scorePercent: null, chantingRaw: null, readingRaw: null, hearingRaw: null, flagSick: false, flagOs: false, submittedAt: null };
  }

  // For single-entry (daily): flag if any entry has it.
  // For multi-entry (weekly/monthly): only flag if MORE THAN HALF the entries have it,
  // so that one sick/OS day in a 7-day week doesn't mark the whole week as sick/OS.
  const n = entries.length;
  const flagSick = n === 1 ? !!entries[0].flagSick : entries.filter(e => e.flagSick).length > n / 2;
  const flagOs   = n === 1 ? !!entries[0].flagOs   : entries.filter(e => e.flagOs).length   > n / 2;
  // For tie-breaking by submission time (latest edit = higher rank)
  const submittedAt = entries.reduce((latest, e) => {
    if (!e.submittedAt) return latest;
    const t = String(e.submittedAt);
    return !latest || t > latest ? t : latest;
  }, null as string | null);

  let fieldScores: Record<string, number | string | null>;
  let fieldRawValues: Record<string, number | string | null> = {};
  let chantingRaw: number | null;
  let readingRaw: number | null;
  let hearingRaw: number | null;

  if (isResident) {
    // Helper: get a resident field value — prefer direct DB column, fallback to fieldValuesJson
    // FIX: if the DB column has a value (including 0), trust it — do NOT fall through to JSON,
    // because JSON may contain stale frontend values (e.g. report_sending=1 for a backdated entry
    // where the server correctly stored reportSendingPoints=0).
    const getResidentVal = (entry: any, directField: string, jsonKey?: string): number | null => {
      const direct = entry[directField];
      // Trust the DB column whenever it is set (even 0 means explicitly zero-scored)
      if (direct != null) return direct;
      // Only fall back to fieldValuesJson if the DB column is absent/null
      if (jsonKey) {
        const fv = parseFieldValues(entry.fieldValuesJson);
        const v = fv[jsonKey];
        if (v != null) return Number(v);
      }
      return null;
    };

    const getResidentAvg = (field: string, jsonKey?: string): number | null =>
      numAvg(entries.map(e => getResidentVal(e, field, jsonKey)));

    // SICK/OS FIX: For fields NOT scored during sick/OS, only average non-sick/OS entries.
    // This prevents days with 0 SB/cleanliness etc (due to being sick) from dragging down weekly/monthly avgs.
    const normalEntries = entries.filter(e => !e.flagSick && !e.flagOs);
    const getResidentNormalAvg = (field: string, jsonKey?: string): number | null => {
      const src = normalEntries.length > 0 ? normalEntries : entries;
      return numAvg(src.map(e => getResidentVal(e, field, jsonKey)));
    };

    fieldScores = {
      // Non-sick/OS scored fields: average only from normal days
      ma_na_gv:       entries.length === 1 ? getResidentVal(entries[0], 'maNaGvPoints', 'ma_na_gv')       : getResidentNormalAvg('maNaGvPoints', 'ma_na_gv'),
      quotes_tulasi:  entries.length === 1 ? getResidentVal(entries[0], 'quotesTulasiPoints', 'quotes_tulasi')  : getResidentNormalAvg('quotesTulasiPoints', 'quotes_tulasi'),
      japa_visible:   entries.length === 1 ? getResidentVal(entries[0], 'japaVisiblePoints', 'japa_visible')   : getResidentNormalAvg('japaVisiblePoints', 'japa_visible'),
      sb:             entries.length === 1 ? getResidentVal(entries[0], 'sbPoints', 'sb')             : getResidentNormalAvg('sbPoints', 'sb'),
      cleanliness:    entries.length === 1 ? getResidentVal(entries[0], 'cleanlinessPoints', 'cleanliness')    : getResidentNormalAvg('cleanlinessPoints', 'cleanliness'),
      // SSOT: trust DB reportSendingPoints column directly (scored for all entries including sick/OS)
      report_sending: entries.length === 1 ? getReportSendingPts(entries[0]) : numAvg(entries.map(e => getReportSendingPts(e))),
      daily_service:  entries.length === 1 ? getResidentVal(entries[0], 'dailyServicePoints', 'daily_service')   : getResidentNormalAvg('dailyServicePoints', 'daily_service'),
      // Sick/OS scored fields: use all entries (rounds + sp_reading are scored even when sick/OS)
      // Use roundsPoints (computed score 0-4) not raw roundsCount
      rounds:         entries.length === 1 ? getResidentVal(entries[0], 'roundsPoints', 'rounds_points')   : getResidentAvg('roundsPoints', 'rounds_points'),
      // Use spReadingPoints (computed score 0-3) not raw minutes
      sp_reading:     entries.length === 1 ? getResidentVal(entries[0], 'spReadingPoints', 'sp_reading_points') : getResidentAvg('spReadingPoints', 'sp_reading_points'),
      sleep_quality:  entries.length === 1 ? getResidentVal(entries[0], 'sleepQualityPoints', 'sleep_quality')   : getResidentNormalAvg('sleepQualityPoints', 'sleep_quality'),
      // SSOT: japa_finish_time — resolve for single entry; average valid times for multi-day
      japa_finish_time: (() => {
            const getJapaTime = (e: any): string | null => {
              const dbVal = e.japaFinishTime;
              if (dbVal && dbVal !== '00:00') return dbVal;
              const fvJapa = parseFieldValues(e.fieldValuesJson).japa_finish_time;
              const fvStr = fvJapa ? String(fvJapa) : '';
              return (fvStr && fvStr !== '00:00') ? fvStr : null;
            };
            if (entries.length === 1) return getJapaTime(entries[0]);
            // Multi-day: average valid japa times (skip null/00:00 entries)
            const validMins = entries
              .map(e => getJapaTime(e))
              .filter((t): t is string => t !== null)
              .map(t => parseHHMMlocal(t))
              .filter(m => m > 0);
            if (validMins.length === 0) return null;
            return minutesToHHMM(Math.round(validMins.reduce((a, b) => a + b, 0) / validMins.length));
          })(),
      // SSOT: sleep_minutes — return raw minutes (number), same as study_minutes/preaching_raw.
      // Pass 0 through — consistent with study/preaching showing "00:00" for OS/sick entries.
      sleep_minutes: (() => {
            const getSleepMins = (e: any): number => {
              const dbSleep = e.sleepMinutes;
              if (typeof dbSleep === 'number') return dbSleep;
              const fvSleep = parseFieldValues(e.fieldValuesJson).sleep_minutes;
              if (fvSleep == null) return 0;
              if (typeof fvSleep === 'number') return fvSleep;
              if (typeof fvSleep === 'string' && fvSleep.includes(':')) {
                const parts = fvSleep.split(':').map(Number);
                return (parts[0] || 0) * 60 + (parts[1] || 0);
              }
              return Number(fvSleep) || 0;
            };
            if (entries.length === 1) return getSleepMins(entries[0]);
            // Exclude 0 values (NF/unfilled) from multi-day average — same as japa logic
            return numAvgInt(entries.map(e => { const v = getSleepMins(e); return v > 0 ? v : null; })) ?? 0;
          })(),
      study_minutes:  entries.length === 1 ? (entries[0].studyMinutes ?? null)         : numAvgInt(entries.map(e => e.studyMinutes)),
      // SUM preaching/books across days — weekly/monthly should show totals, not per-day averages
      preaching_raw:  entries.length === 1 ? (entries[0].preachingMinutes ?? null)     : entries.reduce((s, e) => s + (e.preachingMinutes ?? 0), 0),
      distribution_raw: entries.length === 1 ? (entries[0].booksDistributed ?? null)  : entries.reduce((s, e) => s + (e.booksDistributed ?? 0), 0),
    };
    chantingRaw = entries.length === 1 ? (entries[0].roundsCount ?? null) : numAvg(entries.map(e => e.roundsCount));
    readingRaw  = entries.length === 1 ? (entries[0].spReadingMinutes ?? null) : numAvg(entries.map(e => e.spReadingMinutes));
    // Phase 3/7 FIX: convert SB pts to representative minutes (0→0, 1→15, 2→30)
    // SICK/OS FIX: use only normal (non-sick/OS) entries for SB average to avoid 0s dragging it down
    hearingRaw  = entries.length === 1
      ? sbPtsToMins(getResidentVal(entries[0], 'sbPoints', 'sb') ?? 0)
      : sbPtsToMins(Math.round(getResidentNormalAvg('sbPoints', 'sb') ?? 0));

    // Raw values: actual user inputs vs scored points (used by "Show Real Values" toggle)
    fieldRawValues = {
      // Rounds: actual count entered vs scored points (0-4)
      rounds: entries.length === 1
        ? (entries[0].roundsCount ?? null)
        : numAvg(entries.map((e: any) => e.roundsCount ?? null)),
      // SP Reading: actual minutes entered vs scored points (0-3)
      sp_reading: entries.length === 1
        ? (entries[0].spReadingMinutes ?? null)
        : numAvgInt(entries.map((e: any) => e.spReadingMinutes ?? null)),
      // Binary fields → "Yes"/"No" for single day, "X/Yd" for multi-day
      report_sending: (() => {
        if (entries.length === 1) return getReportSendingPts(entries[0]) >= 1 ? 'Yes' : 'No';
        const n = entries.filter((e: any) => getReportSendingPts(e) >= 1).length;
        return `${n}/${entries.length}d`;
      })(),
      cleanliness: (() => {
        if (entries.length === 1) return (getResidentVal(entries[0], 'cleanlinessPoints', 'cleanliness') ?? 0) >= 1 ? 'Yes' : 'No';
        const n = entries.filter((e: any) => (getResidentVal(e, 'cleanlinessPoints', 'cleanliness') ?? 0) >= 1).length;
        return `${n}/${entries.length}d`;
      })(),
      sleep_quality: (() => {
        if (entries.length === 1) return (getResidentVal(entries[0], 'sleepQualityPoints', 'sleep_quality') ?? 0) >= 1 ? 'Yes' : 'No';
        const n = entries.filter((e: any) => (getResidentVal(e, 'sleepQualityPoints', 'sleep_quality') ?? 0) >= 1).length;
        return `${n}/${entries.length}d`;
      })(),
      quotes_tulasi: (() => {
        if (entries.length === 1) return (getResidentVal(entries[0], 'quotesTulasiPoints', 'quotes_tulasi') ?? 0) >= 1 ? 'Yes' : 'No';
        const n = entries.filter((e: any) => (getResidentVal(e, 'quotesTulasiPoints', 'quotes_tulasi') ?? 0) >= 1).length;
        return `${n}/${entries.length}d`;
      })(),
      // Multi-level scored fields — keep numeric raw value (same as score in these cases)
      ma_na_gv: entries.length === 1
        ? getResidentVal(entries[0], 'maNaGvPoints', 'ma_na_gv')
        : getResidentNormalAvg('maNaGvPoints', 'ma_na_gv'),
      japa_visible: entries.length === 1
        ? getResidentVal(entries[0], 'japaVisiblePoints', 'japa_visible')
        : getResidentNormalAvg('japaVisiblePoints', 'japa_visible'),
      sb: entries.length === 1
        ? getResidentVal(entries[0], 'sbPoints', 'sb')
        : getResidentNormalAvg('sbPoints', 'sb'),
      daily_service: entries.length === 1
        ? getResidentVal(entries[0], 'dailyServicePoints', 'daily_service')
        : getResidentNormalAvg('dailyServicePoints', 'daily_service'),
    };
  } else {
    const allFv = entries.map(e => parseFieldValues(e.fieldValuesJson));
    const getFvNum = (key: string) => allFv.map(fv => {
      const v = fv[key];
      return typeof v === 'number' ? v : (v != null ? Number(v) : null);
    });
    // SICK/OS FIX: hearing is NOT scored during sick/OS — use only normal entries for avg
    const normalNREntries = entries.filter(e => !e.flagSick && !e.flagOs);
    const allFvNormal = normalNREntries.map(e => parseFieldValues(e.fieldValuesJson));

    // Read stored computed pts (_pts_* keys) for accuracy — these match what goes into totalScore.
    // Fallback to raw value only if pts not stored (older entries).
    const getNRPts = (fv: any, key: string): number | null => {
      const v = fv[`_pts_${key}`] ?? fv[`_nr_pts_${key}`];
      return v != null ? Number(v) : null;
    };

    // fillingSameDay: MUST use actual pts (0/2/4 from day-delay rule), NOT the raw toggle (0/1).
    // Toggle=true just means user claimed same-day; actual pts depend on how late they really submitted.
    const getNRFillingPts = (fv: any, entry: any): number | null => {
      // 1st: stored computed pts (set by frontend day-delay calculation)
      const stored = fv._pts_fillingSameDay ?? fv._nr_pts_fillingSameDay;
      if (stored != null) return Number(stored);
      // 2nd: recompute from actual submittedAt vs entryDate (day-delay rule: -2 pts/day, max 4)
      if (entry.submittedAt && entry.entryDate) {
        const entryD = new Date(String(entry.entryDate).slice(0, 10) + 'T00:00:00');
        const subD = new Date(String(entry.submittedAt));
        subD.setHours(0, 0, 0, 0);
        const dayDelay = Math.max(0, Math.round((subD.getTime() - entryD.getTime()) / 86400000));
        return Math.max(0, 4 - dayDelay * 2);
      }
      // Last resort: fallback to toggle (inaccurate — returns 0 or 1 not actual pts)
      return fv.fillingSameDay === true || fv.fillingSameDay === 1 ? 1 : 0;
    };

    // ── NR ashray-level helpers ───────────────────────────────────────────
    // Used to determine whether each field is scored, leaderboard-only, or N/A.
    // Source of truth: src/config/sadhanaFields.ts → NON_RESIDENT_FIELDS criteria
    const level = normalizeAshrayLevel(ashrayLevel);
    // wakeUptime/sleepTime: N/A for Jigyasa/Shraddhavan/Gauranga Sabha; 'enabled' (no target) for Sevak/Sadhaka → show null
    const isNA_WakeSleep     = ['Jigyasa', 'Shraddhavan', 'Gauranga Sabha'].includes(level);
    const isEnabled_WakeSleep = ['Sevak', 'Sadhaka'].includes(level);
    // fillingSameDay: N/A for Jigyasa/Shraddhavan/Gauranga Sabha
    const isNA_FillDay = isNA_WakeSleep;
    // Seva: N/A for Jigyasa/Shraddhavan/Gauranga Sabha; leaderboard for Sevak/Sadhaka; scored for Upasaka+
    const isNA_Seva          = isNA_WakeSleep;
    const isLeaderboard_Seva = ['Sevak', 'Sadhaka'].includes(level);
    const isScored_Seva      = ['Upasaka', 'Caranashraya', 'Harinam Diksha'].includes(level);
    // BV: N/A for Jigyasa/Shraddhavan/Gauranga Sabha; leaderboard for Sevak/Sadhaka/Upasaka; scored for Caranashraya+
    const isNA_BV            = isNA_WakeSleep;
    const isLeaderboard_BV   = ['Sevak', 'Sadhaka', 'Upasaka'].includes(level);
    const isScored_BV        = ['Caranashraya', 'Harinam Diksha'].includes(level);

    // ── NR: fieldRawValues = actual user inputs (shown via "Show Real Values" toggle) ──
    fieldRawValues = {
      wakeUptime: entries.length === 1
        ? (allFv[0].wakeUptime || null)
        : (() => {
            const times = allFv.map(fv => fv.wakeUptime).filter(Boolean);
            if (times.length === 0) return null;
            const total = times.reduce((s: number, t: string) => s + parseHHMMlocal(t), 0);
            return minutesToHHMM(Math.round(total / times.length));
          })(),
      sleepTime: entries.length === 1
        ? (allFv[0].sleepTime || null)
        : (() => {
            const times = allFv.map(fv => fv.sleepTime).filter(Boolean);
            if (times.length === 0) return null;
            const total = times.reduce((s: number, t: string) => s + parseHHMMlocal(t), 0);
            return minutesToHHMM(Math.round(total / times.length));
          })(),
      chanting: entries.length === 1
        ? (() => { const v = allFv[0].chanting ?? allFv[0].rounds; return v != null ? Number(v) : 0; })()
        : numAvg(allFv.map(fv => { const v = fv.chanting ?? fv.rounds; return v != null ? Number(v) : null; })),
      reading: entries.length === 1
        ? (allFv[0].reading != null ? Number(allFv[0].reading) : 0)
        : numAvg(allFv.map(fv => fv.reading != null ? Number(fv.reading) : null)),
      hearing: entries.length === 1
        ? (allFv[0].hearing != null ? Number(allFv[0].hearing) : 0)
        : numAvg((allFvNormal.length > 0 ? allFvNormal : allFv).map(fv => fv.hearing != null ? Number(fv.hearing) : null)),
      fillingSameDay: (() => {
        if (isNA_FillDay) return null;
        if (entries.length === 1) return computeDayDelay(entries[0]) === 0 ? 'Yes' : 'No';
        const onTime = entries.filter(e => computeDayDelay(e) === 0).length;
        return `${onTime}/${entries.length}d`;
      })(),
      seva: (() => {
        if (isNA_Seva) return null;
        if (entries.length === 1) return (allFv[0].seva === true || allFv[0].seva === 1) ? 'Yes' : 'No';
        const yc = allFv.filter(fv => fv.seva === true || fv.seva === 1).length;
        return `${yc}/${entries.length}d`;
      })(),
      bhaktiVriksha: (() => {
        if (isNA_BV) return null;
        if (entries.length === 1) return (allFv[0].bhaktiVriksha === true || allFv[0].bhaktiVriksha === 1) ? 'Yes' : 'No';
        const yc = allFv.filter(fv => fv.bhaktiVriksha === true || fv.bhaktiVriksha === 1).length;
        return `${yc}/${entries.length}d`;
      })(),
      nr_preaching: entries.length === 1
        ? (entries[0].preachingMinutes ?? (Number(allFv[0].preaching_raw) || null))
        : entries.reduce((s, e) => s + (e.preachingMinutes ?? 0), 0) || null,
      nr_books: entries.length === 1
        ? (entries[0].booksDistributed ?? (Number(allFv[0].distribution_raw) || null))
        : entries.reduce((s, e) => s + (e.booksDistributed ?? 0), 0) || null,
    };

    // ── NR: fieldScores = scored points (default view) ──
    fieldScores = {
      wakeUptime: (() => {
        if (isNA_WakeSleep) return null;
        return entries.length === 1 ? (getNRPts(allFv[0], 'wakeUptime') ?? 0) : numAvg(allFv.map(fv => getNRPts(fv, 'wakeUptime')));
      })(),
      sleepTime: (() => {
        if (isNA_WakeSleep) return null;
        return entries.length === 1 ? (getNRPts(allFv[0], 'sleepTime') ?? 0) : numAvg(allFv.map(fv => getNRPts(fv, 'sleepTime')));
      })(),
      chanting: entries.length === 1
        ? (getNRPts(allFv[0], 'chanting') ?? 0)
        : numAvg(allFv.map(fv => getNRPts(fv, 'chanting'))),
      reading: entries.length === 1
        ? (getNRPts(allFv[0], 'reading') ?? 0)
        : numAvg(allFv.map(fv => getNRPts(fv, 'reading'))),
      hearing: entries.length === 1
        ? (getNRPts(allFv[0], 'hearing') ?? 0)
        : numAvg((allFvNormal.length > 0 ? allFvNormal : allFv).map(fv => getNRPts(fv, 'hearing'))),
      fillingSameDay: (() => {
        if (isNA_FillDay) return null;
        return entries.length === 1
          ? (getNRFillingPts(allFv[0], entries[0]) ?? 0)
          : numAvg(entries.map((e, i) => getNRFillingPts(allFv[i], e)));
      })(),
      seva: (() => {
        if (isNA_Seva) return null;
        return entries.length === 1 ? (getNRPts(allFv[0], 'seva') ?? 0) : numAvg(allFv.map(fv => getNRPts(fv, 'seva')));
      })(),
      bhaktiVriksha: (() => {
        if (isNA_BV) return null;
        return entries.length === 1 ? (getNRPts(allFv[0], 'bhaktiVriksha') ?? 0) : numAvg(allFv.map(fv => getNRPts(fv, 'bhaktiVriksha')));
      })(),
      // Informational fields: keep raw (no scored points for these)
      nr_preaching: entries.length === 1
        ? (entries[0].preachingMinutes ?? (Number(allFv[0].preaching_raw) || null))
        : entries.reduce((s, e) => s + (e.preachingMinutes ?? 0), 0) || null,
      nr_books: entries.length === 1
        ? (entries[0].booksDistributed ?? (Number(allFv[0].distribution_raw) || null))
        : entries.reduce((s, e) => s + (e.booksDistributed ?? 0), 0) || null,
    };
    // Raw values kept for summary cards (chanting=rounds, reading/hearing=minutes)
    chantingRaw = entries.length === 1
      ? (allFv[0].chanting ?? allFv[0].rounds ?? entries[0].roundsCount ?? null)
      : numAvg(getFvNum('chanting').map((v, i) => v ?? entries[i].roundsCount ?? 0));
    readingRaw  = entries.length === 1 ? (allFv[0].reading ?? null) : numAvg(getFvNum('reading'));
    hearingRaw  = entries.length === 1 ? (allFv[0].hearing ?? null) : numAvg(
      (allFvNormal.length > 0 ? allFvNormal : allFv).map(fv => {
        const v = fv.hearing;
        return typeof v === 'number' ? v : (v != null ? Number(v) : null);
      })
    );
  }

  // Compute scorePercent: use MAX of (sum of individual field scores) vs (DB totalScore).
  // - Individual field scores reflect manual DB edits (e.g. reportSendingPoints set to 1)
  // - DB totalScore is correct for older entries where individual columns may be incomplete (0s)
  // Taking the MAX handles both cases correctly.
  let scorePercent: number | null;
  let totalScore: number;

  if (isResident) {
    // maxScore from DB is authoritative:
    // - normal entries: 20 (19 base fields + 1 report_sending)
    // - sick/OS entries: 8 (rounds 4 + spReading 3 + report_sending 1)
    const RESIDENT_NORMAL_MAX = 20;
    const SICK_OS_MAX = 8;

    const getEntryMax = (e: any): number => {
      const dbMax = Number(e.maxScore);
      if (dbMax > 0) return dbMax;
      return (e.flagSick || e.flagOs) ? SICK_OS_MAX : RESIDENT_NORMAL_MAX;
    };

    if (entries.length === 1) {
      const e = entries[0];
      const isSickOs = !!(e.flagSick || e.flagOs);
      const entryMax = getEntryMax(e);

      let computedTotal: number;
      if (isSickOs) {
        // Sick/OS: only rounds + spReading + report_sending
        computedTotal = (Number(e.roundsPoints) || 0) + (Number(e.spReadingPoints) || 0) + getReportSendingPts(e);
      } else {
        // Normal: all 9 base fields + report_sending
        computedTotal = (Number(e.maNaGvPoints) || 0) + (Number(e.quotesTulasiPoints) || 0) +
          (Number(e.japaVisiblePoints) || 0) + (Number(e.sbPoints) || 0) +
          (Number(e.cleanlinessPoints) || 0) + getReportSendingPts(e) +
          (Number(e.dailyServicePoints) || 0) + (Number(e.roundsPoints) || 0) +
          (Number(e.spReadingPoints) || 0) + (Number(e.sleepQualityPoints) || 0);
      }
      const dbTotal = Number(e.totalScore) || 0;
      // Trust DB totalScore (post-recalculation) unless columns give a higher value
      totalScore = Math.max(computedTotal, dbTotal);
      scorePercent = entryMax > 0 ? Math.min(100, Math.round((totalScore / entryMax) * 100)) : null;
    } else {
      // Multi-entry (weekly/monthly): WEIGHTED % = sum(earned) / sum(max) × 100.
      // Averaging daily percentages is wrong because Sick/OS days (max=8) produce
      // artificially high daily %s (easy to score 7/8=87%) that inflate the weekly
      // average vs normal days (max=20) where 17/20=85% requires real effort.
      // Weighted sum correctly proportions each day's contribution by its difficulty.
      let totalEarned = 0;
      let totalMax = 0;
      for (const e of entries) {
        const isSickOs = !!(e.flagSick || e.flagOs);
        const entryMax = getEntryMax(e);
        let colTotal: number;
        if (isSickOs) {
          colTotal = (Number(e.roundsPoints) || 0) + (Number(e.spReadingPoints) || 0) + getReportSendingPts(e);
        } else {
          colTotal = (Number(e.maNaGvPoints) || 0) + (Number(e.quotesTulasiPoints) || 0) +
            (Number(e.japaVisiblePoints) || 0) + (Number(e.sbPoints) || 0) +
            (Number(e.cleanlinessPoints) || 0) + getReportSendingPts(e) +
            (Number(e.dailyServicePoints) || 0) + (Number(e.roundsPoints) || 0) +
            (Number(e.spReadingPoints) || 0) + (Number(e.sleepQualityPoints) || 0);
        }
        const best = Math.max(colTotal, Number(e.totalScore) || 0);
        totalEarned += Math.min(best, entryMax); // cap per-entry to avoid exceeding max
        totalMax += entryMax;
      }
      totalScore = entries.reduce((s, e) => s + (Number(e.totalScore) || 0), 0);
      scorePercent = totalMax > 0 ? Math.min(100, Math.round((totalEarned / totalMax) * 100)) : null;
    }
  } else {
    // NR: weighted % = sum(totalScore) / sum(maxScore) for multi-day ranges
    if (entries.length === 1) {
      scorePercent = entries[0].scorePercent ?? null;
    } else {
      const earned = entries.reduce((s, e) => s + (Number(e.totalScore) || 0), 0);
      const maxSum = entries.reduce((s, e) => s + (Number(e.maxScore) || 0), 0);
      scorePercent = maxSum > 0
        ? Math.min(100, Math.round((earned / maxSum) * 100))
        : numAvg(entries.map(e => e.scorePercent)); // fallback for old entries lacking maxScore
    }
    totalScore = entries.reduce((s, e) => s + (e.totalScore ?? 0), 0);
  }

  return { fieldScores, fieldRawValues, totalScore, scorePercent, chantingRaw, readingRaw, hearingRaw, flagSick, flagOs, submittedAt };
}



// Phase 7 FIX: 1 pt = 15 min (lower bound of 15–24 min range), 2 pts = 30 min
function sbPtsToMins(pts: number): number {
  return pts <= 0 ? 0 : pts >= 2 ? 30 : 15;
}

export default createEndpoint({
  description: 'Guide detailed sadhana report — daily/weekly/monthly with field scores per user',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    date: z.string(),
    reportType: z.enum(['daily', 'weekly', 'monthly']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    bvslMode: z.boolean().optional(),
    mentorMode: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Authorization: only Guide, Super Guide, BVSL, or Sadhana Mentor may access reports
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor: (context.user as any).isBvMentor });

    const { guideId: inputGuideId, date, reportType, startDate, endDate, bvslMode, mentorMode } = input;
    // BUG 4 FIX: Always ensure valid date strings — never pass undefined to date operations
    const effectiveStart = (startDate || date || '').split('T')[0];
    const effectiveEnd = (endDate || date || '').split('T')[0];
    if (!effectiveStart) throw new Error('Invalid date: no date provided');

    // Resolve guide DB ID
    let guideDbId: string | null = inputGuideId === 'ALL' ? null : inputGuideId;

    // For BVSL/Mentor mode, resolve guide from authenticated user's guide field
    if (bvslMode || mentorMode) {
      const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'guide'] });
      const gid = Array.isArray(userRec?.guide) ? userRec!.guide[0] : userRec?.guide;
      if (gid) {
        guideDbId = gid as string;
      } else {
        // FIX-012: BVSL/Mentor has no guide linked — cannot scope the report
        return { users: [], fieldDefs: FIELD_DEFS, availableResidencies: [], summary: {},
          error: 'No FOLK Guide assigned to your account. Please contact your administrator.' };
      }
    }

    // Get residencies for this guide
    let availableResidencies: { residencyId: string; residencyName: string }[] = [];
    let guideResidencyIds: string[] = [];
    if (guideDbId) {
      const guide = await Guides.findOne({ id: guideDbId, fields: ['id', 'folkResidencies'] });
      guideResidencyIds = Array.isArray(guide?.folkResidencies)
        ? guide!.folkResidencies as string[]
        : (guide?.folkResidencies ? [guide!.folkResidencies as string] : []);
      if (guideResidencyIds.length > 0) {
        const recs = await Promise.all(guideResidencyIds.map(id => FolkResidencies.findOne({ id, fields: ['id', 'residencyName'] })));
        availableResidencies = recs.filter(Boolean).map(r => ({
          residencyId: (r as any).id,
          residencyName: (r as any).residencyName || '',
        }));
      }
    }
    if (!guideDbId) {
      const { records: allRes } = await FolkResidencies.findAll({ filters: { isActive: true }, fields: ['id', 'residencyName'], limit: 200 });
      availableResidencies = allRes.map(r => ({ residencyId: r.id, residencyName: (r as any).residencyName || '' }));
    }

    // Phase 1 FIX: include both guide-assigned users AND users in any of the guide's residencies
    let users: any[] = [];
    if (guideDbId) {
      const userFetchPromises = [
        Users.findAll({ filters: { guide: guideDbId, status: 'Active' }, fields: USER_FIELDS, limit: 2000 }),
        ...guideResidencyIds.map(rid => Users.findAll({ filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })),
        // Include NR users temporarily visiting this FOLK residency
        ...guideResidencyIds.map(rid => Users.findAll({ filters: { temporaryResidency: rid, temporaryResidencyEnabled: true, status: 'Active' } as any, fields: USER_FIELDS, limit: 200 })),
      ];
      const [guideUsersRes, ...residencyUsersArr] = await Promise.all(userFetchPromises);
      const allUsersMap = new Map<string, any>();
      for (const u of guideUsersRes.records) {
        allUsersMap.set(u.id, u);
      }
      for (const res of residencyUsersArr) {
        for (const u of res.records) {
          // Dedup by DB record ID only — custom userId is NOT reliable for dedup
          // (duplicate custom userIds caused valid users to be incorrectly excluded)
          if (!allUsersMap.has(u.id)) {
            allUsersMap.set(u.id, u);
          }
        }
      }
      users = Array.from(allUsersMap.values());
    } else {
      // ALL = super guide — show all Active users across all guides
      const { records } = await Users.findAll({ filters: { status: 'Active' }, fields: USER_FIELDS, limit: 2000 });
      users = records;
    }

    // NR-VIS FIX: Non-residents must only appear for their own assigned guide.
    // Users are fetched broadly by residency above, so without this filter an NR whose guide is
    // "Sreesha Prabhu" would show up in Manmohan Prabhu's report too — causing confusion.
    if (guideDbId) {
      users = users.filter(u => {
        const officialResId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isOfficialResident = !!(u.residencyApproved && officialResId);
        const isTempResident = !!(u.temporaryResidencyEnabled);
        // Residents (official or temporary visiting) always visible to any FOLK guide
        if (isOfficialResident || isTempResident) return true;
        // Non-resident: only visible to their own assigned guide
        const userGuideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;
        return userGuideId === guideDbId;
      });
    }

    // Fix 11: BVSL mode — filter users to only members of this BVSL's own active BV groups
    if (bvslMode) {
      const { records: bvslGroups } = await BvGroups.findAll({
        filters: { bvslLeader: context.user.id, isActive: true } as any,
        fields: ['id'],
        limit: 100,
      });
      if (bvslGroups.length > 0) {
        const groupIds = bvslGroups.map((g: any) => g.id);
        const { records: memberships } = await BvGroupMembers.findAll({
          filters: { group: { in: groupIds } } as any,
          fields: ['id', 'user'],
          limit: 2000,
        });
        // Build a set of DB user IDs who are in any of the BVSL's groups
        const memberDbIds = new Set(
          memberships
            .map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user)
            .filter(Boolean)
        );
        // Retain only BV group members
        users = users.filter(u => memberDbIds.has(u.id));
      } else {
        users = []; // BVSL has no active groups → empty report
      }
    }

    if (users.length === 0) return { users: [], fieldDefs: FIELD_DEFS, availableResidencies, availableGuides: [], currentGuideId: guideDbId, summary: {} };

    // Collect unique guide IDs across all returned users — used for the Guide filter dropdown
    const guideIdsFromUsers = [...new Set(
      users.map(u => Array.isArray(u.guide) ? u.guide[0] : u.guide).filter(Boolean) as string[]
    )];
    // Always include the current guide even if they have no users yet
    const allGuideIds = [...new Set([...(guideDbId ? [guideDbId] : []), ...guideIdsFromUsers])];
    let availableGuides: { guideId: string; guideName: string }[] = [];
    if (allGuideIds.length > 0) {
      const guideRecs = await Promise.all(
        allGuideIds.map(id => Guides.findOne({ id, fields: ['id', 'fullName'] }).catch(() => null))
      );
      availableGuides = guideRecs
        .filter(Boolean)
        .map(r => ({ guideId: r!.id, guideName: (r as any).fullName || r!.id }));
    }

    const userDbIdSet = new Set(users.map(u => u.id));

    // Fetch entries in date range (paginated if needed)
    // BUG 4 FIX: Use string comparison for date-only fields — Date objects cause "Invalid time value"
    const dateFilter = reportType === 'daily'
      ? { entryDate: effectiveStart }
      : { entryDate: { gte: effectiveStart, lte: effectiveEnd } };

    // Paginate until all entries in the date range are fetched (avoids 4000-record silent truncation)
    let allEntries: any[] = [];
    let entryOffset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: dateFilter as any,
        fields: ENTRY_FIELDS,
        limit: 2000,
        offset: entryOffset,
      });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      entryOffset += 2000;
    }

    // ── Streak computation ──
    // For Super Guide (ALL users), skip the expensive 100-day paginated fetch and
    // use the cached `currentStreak` value stored on each user record instead.
    // For individual guides, compute it live from the 100-day window for accuracy.
    const todayStr = getTodayIST();
    const streakEntriesByUser = new Map<string, { entryDate: string; scorePercent: number | null }[]>();
    if (guideDbId !== null) {
      const streakCutoff = daysAgo(todayStr, 100);
      let sOffset = 0;
      while (true) {
        const { records: sRecs, hasMore: sMore } = await SadhanaEntries.findAll({
          filters: { entryDate: { gte: streakCutoff, lte: todayStr } } as any,
          fields: ['id', 'user', 'entryDate', 'scorePercent'],
          limit: 2000,
          offset: sOffset,
        });
        for (const e of sRecs) {
          const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
          if (!uid || !userDbIdSet.has(uid)) continue;
          if (!streakEntriesByUser.has(uid)) streakEntriesByUser.set(uid, []);
          streakEntriesByUser.get(uid)!.push({
            entryDate: (e.entryDate as string) || '',
            scorePercent: (e.scorePercent as number) ?? null,
          });
        }
        if (!sMore) break;
        sOffset += 2000;
      }
    }

    // Group entries by user DB ID (filter to only our users)
    const entriesByUser = new Map<string, any[]>();
    for (const e of allEntries) {
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
      if (!uid || !userDbIdSet.has(uid)) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(e);
    }

    // Build user rows
    const userRows = users.map(u => {
      const officialResidencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const isOfficialResident = !!(u.residencyApproved && officialResidencyId);
      const rawTempRes = u.temporaryResidency;
      const tempResidencyId = Array.isArray(rawTempRes) ? rawTempRes[0] : rawTempRes;
      const isTempResident = !isOfficialResident && !!(u.temporaryResidencyEnabled && tempResidencyId);
      const isResident = isOfficialResident || isTempResident;
      // Always use raw residencyId from the user's residency field, even if residencyApproved is false.
      // This lets NR users (whose application is pending) still be associated with a center.
      const residencyId = officialResidencyId || (isTempResident ? tempResidencyId : null);
      const userEntries = (entriesByUser.get(u.id) || []);
      const submitted = userEntries.length > 0;
      // SCHOLAR FIX: For scholars (temp residents), determine isResident from the entry's
      // actual templateMode — not the user's current status. Entries submitted as NR before
      // becoming a scholar must be aggregated using the NR path, otherwise resident columns
      // (all zeros) get masked by Math.max(computedTotal, dbTotal) which picks up the NR
      // total score and incorrectly inflates the percentage.
      let entryIsResident = isResident;
      if (isTempResident && submitted) {
        // Check the most recent entry's templateMode — if NR, aggregate as NR
        const latestMode = String(userEntries[0].templateMode || '').toUpperCase();
        const isEntryResident = latestMode.includes('RESIDENT') && !latestMode.includes('NON_RESIDENT');
        entryIsResident = isEntryResident;
      }
      const agg = aggregateEntries(userEntries, entryIsResident, u.ashrayLevel);
      // Compute level-aware NR field colors and N/A fields
      const nrFieldColors = !entryIsResident && submitted ? computeNRColors(agg.fieldRawValues, u.ashrayLevel) : undefined;
      const nrFieldNA         = !entryIsResident ? computeNRNAFields(u.ashrayLevel) : undefined;
      const nrFieldLeaderboard = !entryIsResident ? computeNRLeaderboardFields(u.ashrayLevel) : undefined;
      // Compute streak: live from 100-day window for individual guides; use cached DB value for ALL
      const currentStreak = guideDbId !== null
        ? computeStreak(streakEntriesByUser.get(u.id) || [], todayStr)
        : (u.currentStreak ?? 0);
      return {
        id: u.id,             // DB record id — guaranteed unique (used for ranking)
        userId: u.userId || u.id,
        fullName: u.fullName || '',
        phone: u.phone || null,
        ashrayLevel: u.ashrayLevel || null,
        isResident: entryIsResident,
        isTempResident,
        residencyId: residencyId || null,
        submitted,
        fieldScores: agg.fieldScores,
        totalScore: agg.totalScore,
        scorePercent: agg.scorePercent,
        chantingRaw: agg.chantingRaw,
        readingRaw: agg.readingRaw,
        hearingRaw: agg.hearingRaw,
        flagSick: agg.flagSick,
        flagOs: agg.flagOs,
        submittedAt: agg.submittedAt,
        currentStreak,
        fieldRawValues: agg.fieldRawValues,
        nrFieldColors,
        nrFieldNA,
        nrFieldLeaderboard,
        guideId: (Array.isArray(u.guide) ? u.guide[0] : u.guide) as string | null || null,
      };
    });

    return { users: userRows, fieldDefs: FIELD_DEFS, availableResidencies, availableGuides, currentGuideId: guideDbId, summary: {} };
  },
});
