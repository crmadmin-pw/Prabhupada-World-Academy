import { z } from 'zod';
import { createEndpoint, FolkResidencies, Guides, Users, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Get all residencies with resident count, guide info, and 3-month sadhana averages',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async () => {
    const todayStr = getTodayIST();
    const threeMonthsAgo = daysAgo(todayStr, 92);

    // Parallel: residencies, active guides, approved residents
    const [
      { records: residencies },
      { records: guides },
      { records: residents },
    ] = await Promise.all([
      FolkResidencies.findAll({
        fields: ['id', 'residencyName', 'isActive', 'maxCapacity'],
        limit: 200,
      }),
      Guides.findAll({
        filters: { isActive: true },
        fields: ['id', 'guideId', 'fullName', 'abbreviation', 'folkResidencies'],
        limit: 100,
      }),
      Users.findAll({
        filters: { residencyApproved: true, status: 'Active' } as any,
        fields: ['id', 'residency', 'guide'],
        limit: 2000,
      }),
    ]);

    // Build residency → guides array map (from Guides.folkResidencies links)
    // Each entry includes recordId (Guides table UUID) for matching against User.guide
    const residencyGuideMap = new Map<string, Array<{ guideId: string; guideName: string; abbreviation: string; recordId: string }>>();
    for (const g of guides) {
      const rids = Array.isArray(g.folkResidencies)
        ? g.folkResidencies as string[]
        : (g.folkResidencies ? [g.folkResidencies as string] : []);
      for (const rid of rids) {
        if (!residencyGuideMap.has(rid)) residencyGuideMap.set(rid, []);
        residencyGuideMap.get(rid)!.push({
          guideId: (g.guideId as string) || g.id,
          guideName: (g.fullName as string) || '',
          abbreviation: (g.abbreviation as string) || '',
          recordId: g.id,
        });
      }
    }

    // Build residencyId → Set<userId> (approved residents only)
    const residencyUserMap = new Map<string, Set<string>>();
    // Build userId → residencyId reverse map (for entry lookup)
    const userResidencyMap = new Map<string, string>();
    for (const u of residents) {
      const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency as string;
      if (!rid) continue;
      if (!residencyUserMap.has(rid)) residencyUserMap.set(rid, new Set());
      residencyUserMap.get(rid)!.add(u.id);
      userResidencyMap.set(u.id, rid);
    }

    // Build residencyId → guideRecordId → resident count
    const residencyGuideUserCount = new Map<string, Map<string, number>>();
    for (const u of residents) {
      const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency as string;
      if (!rid) continue;
      const guideRecordId = Array.isArray(u.guide) ? u.guide[0] : u.guide as string;
      if (!guideRecordId) continue;
      if (!residencyGuideUserCount.has(rid)) residencyGuideUserCount.set(rid, new Map());
      const guideMap = residencyGuideUserCount.get(rid)!;
      guideMap.set(guideRecordId, (guideMap.get(guideRecordId) ?? 0) + 1);
    }

    // Compute 3 month labels (oldest → newest)
    const today = new Date(todayStr + 'T00:00:00Z');
    const months: { key: string; label: string }[] = [];
    for (let m = 2; m >= 0; m--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      months.push({ key, label });
    }

    // Fetch 3 months of sadhana entries (paginated)
    // residency → month → scores[]
    const residencyMonthScores = new Map<string, Map<string, number[]>>();
    {
      let offset = 0;
      while (true) {
        const { records, hasMore } = await SadhanaEntries.findAll({
          filters: { entryDate: { gte: threeMonthsAgo, lte: todayStr } } as any,
          fields: ['id', 'user', 'entryDate', 'scorePercent'],
          limit: 2000,
          offset,
        });
        for (const e of records) {
          const uid = Array.isArray(e.user) ? e.user[0] : e.user as string;
          if (!uid) continue;
          const rid = userResidencyMap.get(uid);
          if (!rid) continue;
          const pct = e.scorePercent as number | null;
          if (pct == null) continue;
          const monthKey = (e.entryDate as string || '').slice(0, 7); // YYYY-MM
          if (!residencyMonthScores.has(rid)) residencyMonthScores.set(rid, new Map());
          const monthMap = residencyMonthScores.get(rid)!;
          if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
          monthMap.get(monthKey)!.push(pct);
        }
        if (!hasMore) break;
        offset += 2000;
      }
    }

    return residencies.map((r: any) => {
      const guideList = residencyGuideMap.get(r.id) ?? [];
      const guideInfo = guideList[0];
      const residentCount = residencyUserMap.get(r.id)?.size ?? 0;
      const monthMap = residencyMonthScores.get(r.id);

      const monthlyAvgs = months.map(m => {
        const scores = monthMap?.get(m.key) ?? [];
        const avg = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10
          : null;
        return { month: m.label, avg };
      });

      const allScores = months.flatMap(m => monthMap?.get(m.key) ?? []);
      const quarterAvg = allScores.length > 0
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length * 10) / 10
        : null;

      // Enrich guides with per-guide resident count in this residency
      const enrichedGuides = guideList.map(g => ({
        ...g,
        residentCount: residencyGuideUserCount.get(r.id)?.get(g.recordId) ?? 0,
      }));

      return {
        residencyId: r.id,
        residencyName: (r.residencyName as string) || '',
        isActive: r.isActive ?? true,
        guideName: guideInfo?.guideName ?? '',
        guideId: guideInfo?.guideId ?? '',
        guides: enrichedGuides,
        residentCount,
        monthlyAvgs,
        quarterAvg,
      };
    });
  },
});
