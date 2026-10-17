import { z } from 'zod';
import { AppError, createEndpoint, SadhanaEntries, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, HIERARCHY_IDENTITY_FIELDS, isUserInHierarchy } from '@/lib/hierarchyUtils';
import { NON_RESIDENT_FIELDS, RESIDENT_FIELDS } from '../config/sadhanaFields';
import { isPwSadhanaUser, PW_SADHANA_FORM_KEYS } from '@/lib/sadhanaDepartment';
import { formatPwProgress, pwDetailRows, pwScoreFromFieldValues, pwTarget } from '@/lib/pwSadhana';

const PW_FORM_LABELS: Record<string, string> = {
  wakeUp: 'Wake-up Time',
  sleep: 'Sleep Time',
  chanting: 'Chanting (rounds)',
  reading: 'Reading (minutes)',
  hearing: 'Hearing (minutes)',
  heardSbBefore1030: 'Heard SB class before 10:30 AM',
  seva: 'Seva (minutes)',
};

function pwFormDisplay(key: string, val: unknown, chantingTarget: number | null, readingTarget: number | null): string {
  if (key === 'chanting') return formatPwProgress(Number(val), chantingTarget);
  if (key === 'reading') return formatPwProgress(Number(val), readingTarget);
  if (key === 'hearing' || key === 'seva') return `${Number(val) || 0} min`;
  if (key === 'heardSbBefore1030') return val ? 'Yes' : 'No';
  if (val == null || val === '') return '—';
  return String(val);
}
const PW_ACTIVITY_KEYS = new Set([
  'preaching_raw', 'preaching_minutes', 'preachingMinutes',
  'distribution_raw', 'books_distributed', 'booksDistributed',
]);

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
  report_sending: 'Filling Same Day', ma_na_gv: 'DA+NA+GP+Kirtan',
  quotes_tulasi: 'Soulful Japa/Vaishnava Pranam', japa_visible: 'Japa Visibly Done in MTH/Balcony',
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
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    let entry: any;
    const ownerFields = [...HIERARCHY_IDENTITY_FIELDS, 'segment', 'isPrabhupadaWorldUser'];
    // Same rule as the profile's CRM data: a member sees their own entry, and
    // guides, mentors and BV leaders see the members in their hierarchy.
    const callerKeys = new Set([context.user.id, context.user.userId, context.user.uid].filter(Boolean).map(String));
    const assertCanView = async (owner: any, ownerId: string) => {
      const isOwn = [owner?.id, owner?.userId, ownerId].some(value => value && callerKeys.has(String(value)));
      if (isOwn) return;
      if (!isUserInHierarchy(owner || { id: ownerId }, await getScopedHierarchyUserIds(context.user))) {
        throw new AppError({ code: 'FORBIDDEN', message: 'This user is not assigned to your hierarchy' });
      }
    };

    let owner: any = null;
    if (input.entryId) {
      entry = await SadhanaEntries.findOne({ filters: { entryId: input.entryId } });
    } else if (input.userId && input.entryDate) {
      const userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ownerFields })
        || await Users.findOne({ id: input.userId, fields: ownerFields });
      if (userRecord) {
        await assertCanView(userRecord, userRecord.id);
        owner = userRecord;
        entry = await SadhanaEntries.findOne({
          filters: { user: userRecord.id, entryDate: input.entryDate },
        });
      }
    }

    if (!entry) return { found: false, entry: null };

    const ownerId = String(Array.isArray(entry.user) ? entry.user[0] : entry.user || '');
    if (!owner) {
      // Looked up by entryId: the owner is only known once the entry is loaded.
      owner = ownerId ? (
        await Users.findOne({ id: ownerId, fields: ownerFields }) ||
        await Users.findOne({ filters: { userId: ownerId }, fields: ownerFields })
      ) : null;
      await assertCanView(owner, ownerId);
    }
    const isPw = isPwSadhanaUser(owner);

    // Parse stored field values
    let rawFieldValues: Record<string, any> = {};
    if (entry.fieldValuesJson) {
      try { rawFieldValues = JSON.parse(entry.fieldValuesJson); } catch {}
    }

    // Build _meta from stored JSON (if present) or from DB columns
    const meta = rawFieldValues._meta || {};

    // Build the fields array for display
    const fieldKeySet = new Set<string>();
    const fields: Array<{
      fieldKey: string; fieldLabel: string;
      displayValue: string; points?: number; maxPoints?: number;
    }> = [];

    // Determine if this is a non-resident entry
    const templateMode = String(meta.templateMode || entry.templateMode || '').toUpperCase();
    const isNREntry = isPw || templateMode.includes('NON_RESIDENT') || ['NR_TEMPLATE', 'NR'].includes(templateMode);
    // Use the same current schema as the form. Legacy database field rows can
    // still exist for history, but must not relabel a resident's entry using
    // the retired resident form.
    const fieldDefs = (isNREntry ? NON_RESIDENT_FIELDS : RESIDENT_FIELDS)
      .filter(field => !isPw || PW_SADHANA_FORM_KEYS.has(field.fieldKey) || PW_ACTIVITY_KEYS.has(field.fieldKey))
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
    // For NR entries, seva and bhaktiVriksha may be leaderboard-only (no direct pts).
    // Only show maxPoints for these fields if the stored points > 0.
    const NR_LEADERBOARD_RISK_FIELDS = new Set(['seva', 'bhaktiVriksha']);

    // First pass: use field definitions (ordered by displayOrder)
    for (const def of fieldDefs) {
      const key = def.fieldKey;
      if (!key || key.startsWith('_')) continue;
      const val = rawFieldValues[key];
      if (val === undefined || val === null) continue;
      const displayValue = isPw && PW_SADHANA_FORM_KEYS.has(key)
        ? pwFormDisplay(key, val, pwTarget(meta.pwChantingTarget), pwTarget(meta.pwReadingTarget))
        : formatDisplayValue(key, val);
      const points = isPw ? undefined : rawFieldValues[`_pts_${key}`] ?? rawFieldValues[`_nr_pts_${key}`];
      const rawMaxPoints = isPw ? null : (MAX_POINTS_MAP[key] ?? null);
      // For NR leaderboard-risk fields: hide maxPoints badge when points are 0
      const isNRLeaderboardField = isNREntry && NR_LEADERBOARD_RISK_FIELDS.has(key);
      const effectiveMaxPoints = (isNRLeaderboardField && !(typeof points === 'number' && points > 0))
        ? null
        : rawMaxPoints;
      fields.push({
        fieldKey: key,
        fieldLabel: isPw && PW_SADHANA_FORM_KEYS.has(key)
          ? (PW_FORM_LABELS[key] || def.fieldLabel || key)
          : (def.fieldLabel || FIELD_LABEL_MAP[key] || key),
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
      if (isPw && !PW_SADHANA_FORM_KEYS.has(key) && !PW_ACTIVITY_KEYS.has(key)) continue;
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

    const pwScored = isPw ? pwScoreFromFieldValues(entry.fieldValuesJson) : null;
    const pwRows = isPw ? pwDetailRows(entry.fieldValuesJson) : null;
    if (pwRows) {
      return {
        found: true,
        entry: {
          entryId: entry.entryId || entry.id,
          entryDate: entry.entryDate || '',
          totalScore: pwScored?.earned ?? null,
          maxScore: pwScored?.applicableMax ?? null,
          scorePercent: pwScored?.scorePercent ?? null,
          isPw,
          templateMode: meta.templateMode ?? entry.templateMode ?? null,
          submittedAt: entry.submittedAt || '',
          flagSick: entry.flagSick || false,
          flagOs: entry.flagOs || false,
          fields: pwRows,
        },
      };
    }
    return {
      found: true,
      entry: {
        entryId: entry.entryId || entry.id,
        entryDate: entry.entryDate || '',
        totalScore: entry.totalScore ?? (isPw ? null : 0),
        maxScore: isPw ? null : (entry.maxScore ?? meta.maxScore ?? null),
        scorePercent: isPw ? pwScored!.scorePercent : (entry.scorePercent ?? null),
        isPw,
        templateMode: meta.templateMode ?? entry.templateMode ?? null,
        submittedAt: entry.submittedAt || '',
        flagSick: entry.flagSick || false,
        flagOs: entry.flagOs || false,
        fields,
      },
    };
  },
});
