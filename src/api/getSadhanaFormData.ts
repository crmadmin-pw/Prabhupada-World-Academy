import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, SadhanaFields as SadhanaFieldsTable } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { RESIDENT_FIELDS, NON_RESIDENT_FIELDS, toFormField } from '../config/sadhanaFields';
import { serverCacheGetOrFetch } from '../lib/serverCache';

// ── Field cache keys & TTL ─────────────────────────────────────────────────────
export const FIELD_CACHE_KEY_RESIDENT  = 'sadhana_fields:resident';
export const FIELD_CACHE_KEY_NR        = 'sadhana_fields:nonresident';
// Fields almost never change — keep in memory indefinitely.
// Only cleared when an admin explicitly clicks "Sync Fields Cache".
const FIELDS_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years (effectively permanent)

// Shape returned for each form field
type FormField = ReturnType<typeof toFormField>;

// DB fieldType values are capitalized ("Radio") — map to lowercase for consistency
const DB_TYPE_MAP: Record<string, FormField['fieldType']> = {
  radio: 'radio', toggle: 'toggle', multiselect: 'multiselect',
  number: 'number', time: 'time', duration: 'duration', checkbox: 'toggle',
};

/**
 * Load form fields for a given template.
 *
 * Priority:
 *   1. In-memory cache (24h TTL) — zero DB cost after first load
 *   2. SadhanaFields DB table    — allows admin customisation without redeploying
 *   3. Static TypeScript defs    — fallback if DB table is empty
 *
 * To force a refresh, call /api/invalidateSadhanaFieldsCache.
 */
async function loadFormFields(isResident: boolean): Promise<FormField[]> {
  const cacheKey = isResident ? FIELD_CACHE_KEY_RESIDENT : FIELD_CACHE_KEY_NR;

  return serverCacheGetOrFetch<FormField[]>(
    cacheKey,
    async () => {
      const { records } = await SadhanaFieldsTable.findAll({
        filters: { isActive: true, isResidentForm: isResident },
        limit: 200,
      });

      // No custom DB fields → use static definitions (fastest path on first load too)
      if (records.length === 0) {
        const staticFields = isResident ? RESIDENT_FIELDS : NON_RESIDENT_FIELDS;
        return staticFields.map(f => toFormField(f));
      }

      // Build static lookup for fallback values (options, criteria, contextTag)
      const staticSource = isResident ? RESIDENT_FIELDS : NON_RESIDENT_FIELDS;
      const staticMap = new Map(staticSource.map(f => [f.fieldKey, f]));

      return records
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map(r => {
          const stat = staticMap.get(r.fieldKey ?? '');
          const rawType = (r.fieldType ?? 'radio').toLowerCase();
          const fieldType = DB_TYPE_MAP[rawType] ?? 'radio';

          let options: FormField['options'] = stat?.options ?? [];
          if (r.optionsJson) {
            try { options = JSON.parse(r.optionsJson); } catch { /* keep static fallback */ }
          }

          let criteria: string | null = stat?.criteria ? JSON.stringify(stat.criteria) : null;
          if (r.criteriaJson) criteria = r.criteriaJson;

          return {
            fieldId:           r.id,
            fieldKey:          r.fieldKey          ?? stat?.fieldKey        ?? '',
            fieldLabel:        r.fieldLabel         ?? stat?.fieldLabel       ?? '',
            fieldType,
            displayOrder:      r.displayOrder        ?? stat?.displayOrder     ?? 0,
            isRequired:        r.isRequired          ?? stat?.isRequired       ?? false,
            contributesToScore: r.contributesToScore ?? stat?.contributesToScore ?? false,
            maxPoints:         r.maxPoints           ?? 0,
            minValue:          r.minValue            ?? 0,
            maxValue:          r.maxValue            ?? 100,
            group:             r.group               ?? 'General',
            helpText:          r.helpText            ?? null,
            contextTag:        (stat?.contextTag     ?? null) as FormField['contextTag'],
            options,
            criteria,
          } satisfies FormField;
        });
    },
    FIELDS_TTL_MS
  );
}

// ── User/entry field selectors ─────────────────────────────────────────────────
const USER_FIELDS  = ['id', 'residency', 'residencyApproved', 'residencyJoinDate', 'ashrayLevel',
  'role', 'temporaryResidencyEnabled', 'temporaryResidency'];
const ENTRY_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'templateMode', 'ashrayLevelUsed', 'flagSick', 'flagOs', 'submittedAt', 'fieldValuesJson'];

export default createEndpoint({
  description: 'Get sadhana form data — fields config + existing entry for date (with temp residency support)',
  authenticated: true,
  inputSchema: z.object({
    userId:    z.string().optional(),
    date:      z.string().optional(),
    entryDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const entryDate = (input.date || input.entryDate || getTodayIST()).split('T')[0];
    const userId    = context.user!.id;

    // Fetch user info + existing entry in parallel (both needed fresh)
    const [userInfo, existingEntry] = await Promise.all([
      Users.findOne({ id: userId, fields: USER_FIELDS }),
      SadhanaEntries.findOne({ filters: { user: userId, entryDate }, fields: ENTRY_FIELDS }),
    ]);

    const officialResidencyId = Array.isArray(userInfo?.residency)
      ? userInfo!.residency[0] : userInfo?.residency;
    const isOfficialResident = !!(userInfo?.residencyApproved && officialResidencyId);

    const rawTempResidency = userInfo?.temporaryResidency;
    const tempResidencyId  = Array.isArray(rawTempResidency) ? rawTempResidency[0] : rawTempResidency;
    const tempResidencyEnabled = !!(userInfo?.temporaryResidencyEnabled);
    const isTempResident = !isOfficialResident && !!(tempResidencyEnabled && tempResidencyId);

    const isResident    = isOfficialResident || isTempResident;
    const templateMode  = isResident ? 'RESIDENT_TEMPLATE' : 'NON_RESIDENT_TEMPLATE';

    // ✅ Fields loaded from memory cache — zero DB cost after first load
    // fillingSameDay is auto-computed server-side (like report_sending for residents) — never shown in form
    const visibleFields = (await loadFormFields(isResident)).filter(f => f.fieldKey !== 'fillingSameDay' && f.fieldKey !== 'report_sending');

    let parsedFieldValues: Record<string, unknown> = {};
    if (existingEntry?.fieldValuesJson) {
      if (typeof existingEntry.fieldValuesJson === 'object') {
        parsedFieldValues = existingEntry.fieldValuesJson as any;
      } else {
        try { parsedFieldValues = JSON.parse(existingEntry.fieldValuesJson); } catch { /* ignore */ }
      }
    }

    return {
      fields: visibleFields,
      templateMode,
      ashrayLevel:          userInfo?.ashrayLevel || 'Jigyasa',
      userJoinDate:         userInfo?.residencyJoinDate,
      residencyJoinDate:    userInfo?.residencyJoinDate,
      userRole:             userInfo?.role || 'User',
      isResident,
      isOfficialResident,
      tempResidencyEnabled: isTempResident,
      tempResidencyId:      isTempResident ? (tempResidencyId as string) : null,
      exists:               !!existingEntry,
      entry: existingEntry ? {
        entryId:        existingEntry.entryId,
        rowId:          existingEntry.id,
        entryDate:      existingEntry.entryDate,
        totalScore:     existingEntry.totalScore  || 0,
        maxScore:       existingEntry.maxScore    || 0,
        scorePercent:   existingEntry.scorePercent || 0,
        templateMode:   existingEntry.templateMode || templateMode,
        ashrayLevelUsed: existingEntry.ashrayLevelUsed || '',
        fieldValues:    parsedFieldValues,
        flagSick:       existingEntry.flagSick || false,
        flagOs:         existingEntry.flagOs   || false,
        submittedAt:    existingEntry.submittedAt || '',
      } : null,
    };
  },
});
