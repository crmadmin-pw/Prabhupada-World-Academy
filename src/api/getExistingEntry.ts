import { z } from 'zod';
import { createEndpoint, SadhanaEntries } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get existing sadhana entry for a specific date',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string().optional(),
    date: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const entryDate = input.date.split('T')[0];
    const entry = await SadhanaEntries.findOne({
      filters: { user: context.user!.id, entryDate },
    });

    if (!entry) return { entry: null };

    let fieldValues: Record<string, any> = {};
    if (entry.fieldValuesJson) {
      if (typeof entry.fieldValuesJson === 'object') {
        fieldValues = entry.fieldValuesJson as any;
      } else {
        try { fieldValues = JSON.parse(entry.fieldValuesJson); } catch { /* ok */ }
      }
    }

    return {
      entry: {
        entryId: entry.entryId || entry.id,
        rowId: entry.id,
        entryDate: entry.entryDate || '',
        totalScore: entry.totalScore ?? 0,
        maxScore: entry.maxScore ?? 0,
        scorePercent: entry.scorePercent ?? null,
        templateMode: entry.templateMode || 'NON_RESIDENT_TEMPLATE',
        ashrayLevelUsed: entry.ashrayLevelUsed || '',
        fieldValues,
        flagSick: entry.flagSick || false,
        flagOs: entry.flagOs || false,
        submittedAt: entry.submittedAt || '',
      },
    };
  },
});
