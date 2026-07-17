import { z } from 'zod';
import { createEndpoint, SadhanaEntries } from 'zite-integrations-backend-sdk';

// Only the fields needed for the history view — avoids large fieldValuesJson on list
const LIST_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'templateMode', 'ashrayLevelUsed', 'flagSick', 'flagOs', 'submittedAt',
  'roundsCount', 'sbPoints', 'spReadingMinutes', 'preachingMinutes', 'sleepMinutes',
  'maNaGvPoints', 'quotesTulasiPoints', 'japaVisiblePoints', 'cleanlinessPoints',
  'reportSendingPoints', 'dailyServicePoints', 'roundsPoints', 'spReadingPoints', 'sleepQualityPoints'];

// Full fields needed for detail view
const FULL_FIELDS = [...LIST_FIELDS, 'fieldValuesJson'];

export default createEndpoint({
  description: 'Get paginated sadhana history for the authenticated user (optimized)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
    days: z.number().optional(),
    includeFieldValues: z.boolean().optional(), // only load JSON when needed
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;
    const fields = input.includeFieldValues ? FULL_FIELDS : LIST_FIELDS;

    const { records, hasMore } = await SadhanaEntries.findAll({
      filters: { user: context.user!.id },
      fields,
      limit,
      offset,
    });

    // Sort descending by date
    const sorted = [...records].sort((a, b) =>
      (b.entryDate || '').localeCompare(a.entryDate || '')
    );

    return {
      entries: sorted.map(e => {
        let fieldValues: Record<string, any> = {};
        if (input.includeFieldValues && e.fieldValuesJson) {
          try { fieldValues = JSON.parse(e.fieldValuesJson); } catch { /* ok */ }
        }
        // For residents: recalculate scorePercent using MAX(column sum, DB total)
        const isNR = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
        let scorePercent = e.scorePercent ?? null;
        if (!isNR) {
          const colSum = Number(e.maNaGvPoints ?? 0) + Number(e.quotesTulasiPoints ?? 0) +
            Number(e.japaVisiblePoints ?? 0) + Number(e.sbPoints ?? 0) +
            Number(e.cleanlinessPoints ?? 0) + Number(e.reportSendingPoints ?? 0) +
            Number(e.dailyServicePoints ?? 0) + Number(e.roundsPoints ?? 0) +
            Number(e.spReadingPoints ?? 0) + Number(e.sleepQualityPoints ?? 0);
          const bestTotal = Math.max(colSum, Number(e.totalScore) || 0);
          const dbMax = Math.max(Number(e.maxScore) || 20, 1);
          scorePercent = Math.min(100, Math.round((bestTotal / dbMax) * 100));
        }
        return {
          entryId: e.entryId || e.id,
          rowId: e.id,
          entryDate: e.entryDate || '',
          totalScore: e.totalScore ?? 0,
          maxScore: e.maxScore ?? 0,
          scorePercent,
          templateMode: e.templateMode || 'NON_RESIDENT_TEMPLATE',
          ashrayLevelUsed: e.ashrayLevelUsed || '',
          flagSick: e.flagSick || false,
          flagOs: e.flagOs || false,
          submittedAt: e.submittedAt || '',
          fieldValues,
          roundsCount: e.roundsCount ?? 0,
          sbPoints: e.sbPoints ?? 0,
          spReadingMinutes: e.spReadingMinutes ?? 0,
          preachingMinutes: e.preachingMinutes ?? 0,
          sleepMinutes: e.sleepMinutes ?? 0,
        };
      }),
      hasMore,
      total: records.length,
    };
  },
});
