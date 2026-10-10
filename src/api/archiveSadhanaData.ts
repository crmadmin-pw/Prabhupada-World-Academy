import { z } from 'zod';
import { createEndpoint, AppError, SadhanaEntries, SadhanaMonthlySummaries } from '@/lib/backend-sdk';
import { computeStreak, daysAgo } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Archive old sadhana entries into monthly summaries and delete the raw entries — Super Guide only',
  authenticated: true,
  inputSchema: z.object({
    cutoffDate: z.string(), // YYYY-MM-DD
    confirm: z.string(),    // must be "ARCHIVE"
  }),
  outputSchema: z.object({
    summarized: z.number(),
    deleted: z.number(),
    months: z.array(z.string()),
  }),
  execute: async ({ input, context }) => {
    if (context.user!.role !== 'Super Guide') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Guide access required' });
    }
    if (input.confirm !== 'ARCHIVE') {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Confirmation required' });
    }

    const cutoff = input.cutoffDate; // YYYY-MM-DD string for comparison

    // ── Step 1: Paginate all entries before cutoff ─────────────────────────────
    const allEntries: Array<{
      id: string;
      userId: string;
      entryDate: string;
      month: string; // YYYY-MM
      scorePercent: number;
      totalScore: number;
      maxScore: number;
      rounds: number;
      flagSick: boolean;
      flagOs: boolean;
      templateMode: string;
    }> = [];

    let offset = 0;
    const FETCH_LIMIT = 2000;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        fields: ['id', 'user', 'entryDate', 'scorePercent', 'totalScore', 'maxScore',
          'roundsCount', 'nrChantingRounds', 'flagSick', 'flagOs', 'templateMode'],
        limit: FETCH_LIMIT,
        offset,
      });

      for (const r of records) {
        const dateStr = (r.entryDate || '').substring(0, 10); // YYYY-MM-DD
        if (dateStr >= cutoff) continue; // skip entries on or after cutoff

        const userId = Array.isArray(r.user) ? r.user[0] : (r.user || '');
        if (!userId) continue;

        const month = dateStr.substring(0, 7); // YYYY-MM
        const rounds = (r.roundsCount ?? r.nrChantingRounds ?? 0) as number;

        allEntries.push({
          id: r.id,
          userId,
          entryDate: dateStr,
          month,
          scorePercent: (r.scorePercent as number) ?? 0,
          totalScore: (r.totalScore as number) ?? 0,
          maxScore: (r.maxScore as number) ?? 0,
          rounds,
          flagSick: r.flagSick === true,
          flagOs: r.flagOs === true,
          templateMode: (r.templateMode as string) || 'Unknown',
        });
      }

      offset += records.length;
      if (!hasMore) break;
    }

    if (allEntries.length === 0) {
      return { summarized: 0, deleted: 0, months: [] };
    }

    // ── Step 2: Group by userId + month ──────────────────────────────────────
    type GroupKey = string; // `${userId}::${month}`
    const groups = new Map<GroupKey, typeof allEntries>();

    for (const e of allEntries) {
      const key = `${e.userId}::${e.month}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    // ── Step 3: Check existing summaries to avoid duplicates ─────────────────
    // Build set of already-archived user+month combos
    const existingKeys = new Set<string>();
    const { records: existingSummaries } = await SadhanaMonthlySummaries.findAll({
      fields: ['user', 'month'],
      limit: 2000,
    });
    for (const s of existingSummaries) {
      const uid = Array.isArray(s.user) ? s.user[0] : (s.user || '');
      if (uid && s.month) existingKeys.add(`${uid}::${s.month}`);
    }

    // ── Step 4: Build summary records ────────────────────────────────────────
    const now = new Date().toISOString();
    const summariesToCreate: Array<{
      user: string;
      month: string;
      daysFiled: number;
      avgScorePercent: number;
      totalScore: number;
      totalMaxScore: number;
      avgRounds: number;
      sickDays: number;
      osDays: number;
      templateMode: string;
      streakAtMonthEnd: number;
      entriesArchived: number;
      archivedAt: string;
    }> = [];

    const entryIdsToDelete: string[] = [];
    const monthsSet = new Set<string>();
    const historyByUser = new Map<string, Array<{ entryDate: string; scorePercent: number | null }>>();
    for (const entry of allEntries) {
      const history = historyByUser.get(entry.userId) || [];
      history.push({ entryDate: entry.entryDate, scorePercent: entry.scorePercent });
      historyByUser.set(entry.userId, history);
    }

    for (const [key, entries] of groups) {
      if (existingKeys.has(key)) continue; // already archived — skip

      const count = entries.length;
      const avgScorePercent = entries.reduce((s, e) => s + e.scorePercent, 0) / count;
      const totalScore = entries.reduce((s, e) => s + e.totalScore, 0);
      const totalMaxScore = entries.reduce((s, e) => s + e.maxScore, 0);
      const avgRounds = entries.reduce((s, e) => s + e.rounds, 0) / count;
      const sickDays = entries.filter(e => e.flagSick).length;
      const osDays = entries.filter(e => e.flagOs).length;

      // Determine dominant template mode
      const modeCount: Record<string, number> = {};
      for (const e of entries) {
        const m = e.templateMode.includes('Resident') && !e.templateMode.includes('Non')
          ? 'Resident' : 'Non-Resident';
        modeCount[m] = (modeCount[m] || 0) + 1;
      }
      const modes = Object.keys(modeCount);
      const dominantMode = modes.length > 1 ? 'Mixed'
        : modes[0] === 'Resident' ? 'Resident' : 'Non-Resident';

      const [userId, month] = key.split('::');
      const periodEnd = monthEnd(month);
      const asOf = periodEnd < cutoff ? periodEnd : daysAgo(cutoff, 1);
      const history = (historyByUser.get(userId) || []).filter(item => item.entryDate >= daysAgo(asOf, 100) && item.entryDate <= asOf);
      summariesToCreate.push({
        user: userId,
        month,
        daysFiled: count,
        avgScorePercent: avgScorePercent / 100, // store as decimal (0-1) for percent field
        totalScore,
        totalMaxScore,
        avgRounds,
        sickDays,
        osDays,
        templateMode: dominantMode,
        streakAtMonthEnd: computeStreak(history, asOf),
        entriesArchived: count,
        archivedAt: now,
      });

      for (const e of entries) entryIdsToDelete.push(e.id);
      monthsSet.add(month);
    }

    // ── Step 5: BulkCreate summaries in chunks of 100 ────────────────────────
    const BULK_SIZE = 100;
    for (let i = 0; i < summariesToCreate.length; i += BULK_SIZE) {
      const chunk = summariesToCreate.slice(i, i + BULK_SIZE);
      await SadhanaMonthlySummaries.bulkCreate({ records: chunk });
    }

    // ── Step 6: Delete raw entries sequentially (rate-limit safe) ────────────
    // Delete in sequential batches of 20 with small delay to stay under rate limit
    let deleted = 0;
    const DELETE_BATCH = 20;
    for (let i = 0; i < entryIdsToDelete.length; i += DELETE_BATCH) {
      const batch = entryIdsToDelete.slice(i, i + DELETE_BATCH);
      await Promise.all(batch.map(id => SadhanaEntries.delete({ id })));
      deleted += batch.length;
    }

    return {
      summarized: summariesToCreate.length,
      deleted,
      months: Array.from(monthsSet).sort(),
    };
  },
});

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}
