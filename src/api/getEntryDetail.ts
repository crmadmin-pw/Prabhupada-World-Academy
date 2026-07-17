import { z } from 'zod';
import { createEndpoint, SadhanaEntries, Users, SadhanaFields } from 'zite-integrations-backend-sdk';

// Human-readable labels for common field keys
const FIELD_LABEL_MAP: Record<string, string> = {
  rounds: 'Rounds of Japa', chanting: 'Rounds of Japa',
  rounds_count: 'Rounds', rounds_points: 'Japa Points',
  sp_reading: 'SP Book Reading', sp_reading_minutes: 'SP Book Reading',
  sp_reading_points: 'SP Reading Points',
  sb: 'SB Hearing', hearing: 'SB Hearing',
  reading: 'Reading Points',
  fillingSameDay: 'Filled Same Day (On Time)', on_time: 'On Time',
  seva: 'Seva', bhaktiVriksha: 'Bhakti Vriksha Attendance',
  cleanliness: 'Cleanliness', daily_service: 'Daily Service',
  report_sending: 'Filling Same Day', ma_na_gv: 'MA/NA/GV',
  quotes_tulasi: 'Quotes/Tulasi', japa_visible: 'Japa Visible',
  japa_finish_time: 'Japa Finish Time', sleep_minutes: 'Sleep Hours', sleepTime: 'Sleep Time',
  sleep_quality: 'Sleep Quality', study_minutes: 'Study (min)',
  preaching_raw: 'Preaching (min)', preaching_minutes: 'Preaching (min)',
  distribution_raw: 'Books Distributed', books_distributed: 'Books Distributed',
  flag_sick: 'Sick', flag_os: 'Out of Station',
};

const MAX_POINTS_MAP: Record<string, number | null> = {
  rounds: 4, chanting: 8, sp_reading: 3, reading: 4,
  sb: 2, hearing: 4, fillingSameDay: 4, seva: 4, bhaktiVriksha: 4,
  // Resident same-day filling (binary: 1 if same day IST, 0 if backdate)
  report_sending: 1,
  // Non-resident same-day filling (0–4 pts with 2-pt/day delay penalty)
  // fillingSameDay: 4 — handled via NR criteria scoring
  cleanliness: 1, daily_service: 2, ma_na_gv: 3,
  quotes_tulasi: 1, japa_visible: 2, sleep_quality: 1,
};

function formatDisplayValue(key: string, val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  // Boolean / toggle fields
  if (typeof val === 'boolean') return val ? 'YES' : (key === 'fillingSameDay' || key === 'seva' || key === 'bhaktiVriksha') ? 'No' : '—';
  if (val === 1 || val === true) return 'YES';
  // NR toggle fields: show "No" when 0 so they always appear in the detail view
  if (val === 0 && (key === 'fillingSameDay' || key === 'seva' || key === 'bhaktiVriksha')) return 'No';
  if (val === 0 && key.match(/^(flag_|on_time|cleanliness|report_sending|ma_na_gv|quotes_tulasi|japa_visible|sleep_quality)/)) return '—';
  // Time fields
  if (key === 'sleep_minutes' && typeof val === 'number' && val > 0) {
    const h = Math.floor(val / 60), m = val % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (key === 'japa_finish_time' || key === 'sleepTime') return String(val) || '—';
  // Duration fields (minutes)
  if ((key === 'preaching_raw' || key === 'preaching_minutes' || key === 'study_minutes' || key === 'sp_reading' || key === 'sp_reading_minutes') && typeof val === 'number') {
    const h = Math.floor(val / 60), m = val % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return String(val);
}

export default createEndpoint({
  description: 'Get full detail for a single sadhana entry with field labels',
  authenticated: true,
  inputSchema: z.object({
    entryId: z.string().optional(),
    userId: z.string().optional(),
    entryDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    let entry: any;

    if (input.entryId) {
      entry = await SadhanaEntries.findOne({ filters: { entryId: input.entryId } });
    } else if (input.userId && input.entryDate) {
      const userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });
      if (userRecord) {
        entry = await SadhanaEntries.findOne({
          filters: { user: userRecord.id, entryDate: input.entryDate },
        });
      }
    }

    if (!entry) return { found: false, entry: null };

    // Parse stored field values
    let rawFieldValues: Record<string, any> = {};
    if (entry.fieldValuesJson) {
      try { rawFieldValues = JSON.parse(entry.fieldValuesJson); } catch {}
    }

    // Build _meta from stored JSON (if present) or from DB columns
    const meta = rawFieldValues._meta || {};

    // Try to fetch sadhana field definitions for labels/maxPoints
    let fieldDefs: any[] = [];
    try {
      const { records } = await SadhanaFields.findAll({
        fields: ['fieldKey', 'fieldLabel', 'fieldType', 'contributesToScore', 'displayOrder'],
        limit: 100,
      });
      fieldDefs = records.sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    } catch {
      // Silently fall back to key map
    }

    // Build the fields array for display
    const fieldKeySet = new Set<string>();
    const fields: Array<{
      fieldKey: string; fieldLabel: string;
      displayValue: string; points?: number; maxPoints?: number;
    }> = [];

    // Determine if this is a non-resident entry
    const isNREntry = (meta.templateMode || entry.templateMode || '').toUpperCase().includes('NON_RESIDENT') &&
      !(meta.templateMode || entry.templateMode || '').toUpperCase().startsWith('RESIDENT');
    // For NR entries, seva and bhaktiVriksha may be leaderboard-only (no direct pts).
    // Only show maxPoints for these fields if the stored points > 0.
    const NR_LEADERBOARD_RISK_FIELDS = new Set(['seva', 'bhaktiVriksha']);

    // First pass: use field definitions (ordered by displayOrder)
    for (const def of fieldDefs) {
      const key = def.fieldKey as string;
      if (!key || key.startsWith('_')) continue;
      const val = rawFieldValues[key];
      if (val === undefined || val === null) continue;
      const displayValue = formatDisplayValue(key, val);
      const points = rawFieldValues[`_pts_${key}`] ?? rawFieldValues[`_nr_pts_${key}`];
      const rawMaxPoints = MAX_POINTS_MAP[key] ?? null;
      // For NR leaderboard-risk fields: hide maxPoints badge when points are 0
      const isNRLeaderboardField = isNREntry && NR_LEADERBOARD_RISK_FIELDS.has(key);
      const effectiveMaxPoints = (isNRLeaderboardField && !(typeof points === 'number' && points > 0))
        ? null
        : rawMaxPoints;
      fields.push({
        fieldKey: key,
        fieldLabel: def.fieldLabel || FIELD_LABEL_MAP[key] || key,
        displayValue,
        points: typeof points === 'number' ? points : undefined,
        maxPoints: effectiveMaxPoints !== null ? effectiveMaxPoints : undefined,
      });
      fieldKeySet.add(key);
    }

    // Second pass: include remaining keys not covered by fieldDefs
    // Skip keys ending with _points — they are derived scoring values already shown
    // as a badge next to the raw field row (e.g. rounds_points, sp_reading_points)
    for (const [key, val] of Object.entries(rawFieldValues)) {
      if (key.startsWith('_') || fieldKeySet.has(key)) continue;
      if (key.endsWith('_points')) continue;
      if (val === null || val === undefined) continue;
      const displayValue = formatDisplayValue(key, val);
      if (displayValue === '—') continue; // skip empty/zero non-scored fields
      const points = rawFieldValues[`_pts_${key}`];
      const maxPoints = MAX_POINTS_MAP[key] ?? null;
      fields.push({
        fieldKey: key,
        fieldLabel: FIELD_LABEL_MAP[key] || key,
        displayValue,
        points: typeof points === 'number' ? points : undefined,
        maxPoints: maxPoints !== null ? maxPoints : undefined,
      });
    }

    return {
      found: true,
      entry: {
        entryId: entry.entryId || entry.id,
        entryDate: entry.entryDate || '',
        totalScore: entry.totalScore ?? 0,
        maxScore: entry.maxScore ?? meta.maxScore ?? null,
        scorePercent: entry.scorePercent ?? null,
        templateMode: meta.templateMode ?? entry.templateMode ?? null,
        submittedAt: entry.submittedAt || '',
        flagSick: entry.flagSick || false,
        flagOs: entry.flagOs || false,
        fields,
      },
    };
  },
});
