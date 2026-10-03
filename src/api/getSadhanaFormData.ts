import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, SadhanaFields as SadhanaFieldsTable } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { RESIDENT_FIELDS, NON_RESIDENT_FIELDS, toFormField } from '../config/sadhanaFields';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { getUserDepartment } from '../lib/userDashboardRoutes';
import { isPwSadhanaUser } from '../lib/sadhanaDepartment';
import { pwTarget } from '../lib/pwSadhana';

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
 *   1. Resident static schema — the approved resident form is deployment
 *      controlled and must not be overridden by legacy database rows.
 *   2. In-memory cache / SadhanaFields DB table for non-resident customisation.
 *   3. Static TypeScript definitions as the non-resident fallback.
 *
 * To force a refresh, call /api/invalidateSadhanaFieldsCache.
 */
async function loadFormFields(isResident: boolean): Promise<FormField[]> {
  // The resident form was revised after older SadhanaFields documents had
  // already been seeded. Keeping those rows would bring the removed/old form
  // back. Do not delete them: historical/custom data is preserved, but the
  // current resident form and scoring rules always come from the canonical
  // definitions checked into this application.
  if (isResident) return RESIDENT_FIELDS.map(field => toFormField(field));

  const cacheKey = isResident ? FIELD_CACHE_KEY_RESIDENT : FIELD_CACHE_KEY_NR;

  return serverCacheGetOrFetch<FormField[]>(
    cacheKey,
    async () => {
      const { records } = await SadhanaFieldsTable.findAll({
        filters: { isActive: true, isResidentForm: isResident },
        limit: 200,
      });

      // No custom DB fields → use the approved static non-resident definitions.
      if (records.length === 0) {
        return NON_RESIDENT_FIELDS.map(f => toFormField(f));
      }

      // Build static lookup for fallback values (options, criteria, contextTag)
      const staticMap = new Map(NON_RESIDENT_FIELDS.map(f => [f.fieldKey, f]));

      const databaseFields = records
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

          const key = r.fieldKey ?? stat?.fieldKey ?? '';
          const defaultMax = key === 'chanting' ? 192 : 1200;

          return {
            fieldId:           r.id,
            fieldKey:          key,
            fieldLabel:        r.fieldLabel         ?? stat?.fieldLabel       ?? '',
            fieldType,
            displayOrder:      r.displayOrder        ?? stat?.displayOrder     ?? 0,
            isRequired:        r.isRequired          ?? stat?.isRequired       ?? false,
            contributesToScore: r.contributesToScore ?? stat?.contributesToScore ?? false,
            maxPoints:         r.maxPoints           ?? 0,
            minValue:          r.minValue            ?? 0,
            maxValue:          r.maxValue            ?? stat?.maxValue         ?? defaultMax,
            group:             r.group               ?? 'General',
            helpText:          r.helpText            ?? null,
            contextTag:        (stat?.contextTag     ?? null) as FormField['contextTag'],
            options,
            criteria,
          } satisfies FormField;
        });

      // Older SadhanaFields records predate the informational Preaching
      // Duration and Books Distributed fields. Database customisation may
      // adjust existing fields, but it must not remove canonical fields from
      // the current non-resident/PW form.
      const configuredKeys = new Set(databaseFields.map(field => field.fieldKey));
      const missingCanonicalFields = NON_RESIDENT_FIELDS
        .filter(field => !configuredKeys.has(field.fieldKey))
        .map(field => toFormField(field));

      return [...databaseFields, ...missingCanonicalFields]
        .sort((a, b) => a.displayOrder - b.displayOrder);
    },
    FIELDS_TTL_MS
  );
}

// ── User/entry field selectors ─────────────────────────────────────────────────
const USER_FIELDS  = ['id', 'userId', 'residency', 'residencyApproved', 'residencyJoinDate', 'ashrayLevel',
  'role', 'segment', 'isPrabhupadaWorldUser', 'isFolkUser', 'temporaryResidencyEnabled', 'temporaryResidency',
  'pwChantingTarget', 'pwReadingTarget'];
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

    // Fetch the authoritative user record first.  `userId` is the Firestore
    // document ID, whereas some older records were stored against the custom
    // `Users.userId` value.  Read that legacy location as a fallback so users
    // can open previously submitted dates; the next save migrates the entry.
    const userInfo = await Users.findOne({ id: userId, fields: USER_FIELDS });
    const inputUserId = typeof input.userId === 'string' ? input.userId : '';
    const inputUserIdBelongsToCurrentUser = !!inputUserId && (
      inputUserId === userId ||
      inputUserId === context.user?.uid ||
      inputUserId === userInfo?.userId
    );
    const legacyOwnerIds = [...new Set([
      userInfo?.userId,
      context.user?.uid,
      ...(inputUserIdBelongsToCurrentUser ? [inputUserId] : []),
    ])]
      .filter((id): id is string => !!id && id !== userId);
    const [currentEntry, ...legacyEntries] = await Promise.all([
      SadhanaEntries.findOne({ filters: { user: userId, entryDate }, fields: ENTRY_FIELDS }),
      ...legacyOwnerIds.map(ownerId =>
        SadhanaEntries.findOne({ filters: { user: ownerId, entryDate }, fields: ENTRY_FIELDS })
      ),
    ]);
    const existingEntry = currentEntry || legacyEntries.find(Boolean);

    const officialResidencyId = Array.isArray(userInfo?.residency)
      ? userInfo!.residency[0] : userInfo?.residency;
    const isFolkUser = getUserDepartment(userInfo) === 'FOLK';
    const isOfficialResident = isFolkUser && !!(userInfo?.residencyApproved && officialResidencyId);

    const rawTempResidency = userInfo?.temporaryResidency;
    const tempResidencyId  = Array.isArray(rawTempResidency) ? rawTempResidency[0] : rawTempResidency;
    const tempResidencyEnabled = isFolkUser && !!(userInfo?.temporaryResidencyEnabled);
    const isTempResident = !isOfficialResident && !!(tempResidencyEnabled && tempResidencyId);

    const isPw = isPwSadhanaUser(userInfo);
    const isResident    = isOfficialResident || isTempResident;
    const templateMode  = isResident ? 'RESIDENT_TEMPLATE' : 'NON_RESIDENT_TEMPLATE';

    // ✅ Fields loaded from memory cache — zero DB cost after first load
    // fillingSameDay is auto-computed server-side (like report_sending for residents) — never shown in form
    const loadedFields = (await loadFormFields(isResident)).filter(f => f.fieldKey !== 'fillingSameDay' && f.fieldKey !== 'report_sending');
    const visibleFields = isPw
      ? loadedFields
          .filter(field => field.fieldKey === 'chanting' || field.fieldKey === 'reading')
          .map(field => ({
            ...field,
            fieldType: 'number' as const,
            fieldLabel: field.fieldKey === 'chanting' ? 'Chanting (rounds)' : 'Reading (minutes)',
            criteria: null,
            contributesToScore: false,
            minValue: 0,
            maxValue: field.fieldKey === 'chanting' ? 192 : 1440,
          }))
      : loadedFields;

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
      isPw,
      pwChantingTarget: isPw ? pwTarget(userInfo?.pwChantingTarget) : null,
      pwReadingTarget: isPw ? pwTarget(userInfo?.pwReadingTarget) : null,
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
