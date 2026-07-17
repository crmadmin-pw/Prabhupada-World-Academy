import { z } from 'zod';
import { createEndpoint, ZiteError, SadhanaEntries, SadhanaMonthlySummaries } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get archival stats: entry count, oldest entry, summaries count, last archive date — Super Guide only',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    totalEntries: z.number(),
    hasMoreEntries: z.boolean(),
    oldestEntryDate: z.string().nullable(),
    totalSummaries: z.number(),
    lastArchivedAt: z.string().nullable(),
  }),
  execute: async ({ context }) => {
    if (context.user!.role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }

    // Run queries in parallel
    const [page1, page2, summariesRes, recentSummary] = await Promise.all([
      // Two pages gives us up to 4000 record count before we give up counting
      SadhanaEntries.findAll({ fields: ['id', 'entryDate'], limit: 2000, offset: 0 }),
      SadhanaEntries.findAll({ fields: ['id'], limit: 2000, offset: 2000 }),
      SadhanaMonthlySummaries.findAll({ fields: ['id'], limit: 2000 }),
      SadhanaMonthlySummaries.findAll({ fields: ['archivedAt'], limit: 1 }),
    ]);

    // Find oldest entry from first page
    let oldestEntryDate: string | null = null;
    for (const r of page1.records) {
      const d = (r.entryDate || '').substring(0, 10);
      if (d && (!oldestEntryDate || d < oldestEntryDate)) oldestEntryDate = d;
    }

    const totalEntries = page1.records.length + page2.records.length;
    const hasMoreEntries = page2.hasMore;

    const lastArchivedAt = recentSummary.records[0]?.archivedAt ?? null;

    return {
      totalEntries,
      hasMoreEntries,
      oldestEntryDate,
      totalSummaries: summariesRes.records.length,
      lastArchivedAt: lastArchivedAt ? String(lastArchivedAt) : null,
    };
  },
});
