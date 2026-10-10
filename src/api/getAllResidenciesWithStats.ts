import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { getGuideScope } from '../lib/guideScope';
import { createEndpoint, FolkResidencies, Guides, Users, SadhanaEntries } from '@/lib/backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';
import { isPrabhupadaWorldResidency } from '../lib/residencyCategory';

export default createEndpoint({
  description: 'Get all residencies with resident count, guide info, and 3-month sadhana averages',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    const hierarchy = await getScopedHierarchyUserIds(context.user);
    const guideScope = hierarchy === null ? null : await getGuideScope(context.user?.email || '');
    const todayStr = getTodayIST();
    const threeMonthsAgo = daysAgo(todayStr, 92);

    // Parallel: residencies, active guides, approved residents
    const [
      { records: allResidencies },
      { records: allGuides },
      { records: userGuideRows },
      { records: allResidents },
    ] = await Promise.all([
      FolkResidencies.findAll({
        fields: ['id', 'residencyId', 'residencyName', 'isActive', 'maxCapacity', 'guides', 'guideIds', 'category', 'segment'],
        limit: 200,
      }),
      Guides.findAll({
        filters: { isActive: true },
        fields: ['id', 'guideId', 'fullName', 'abbreviation', 'email', 'folkResidencies', 'segment'],
        limit: 100,
      }),
      // Some seeded/legacy guides exist only in Users. Include those records
      // when resolving hostel assignments so a guide selected in the UI is
      // still displayed even when there is no matching Guides row.
      readScopedUsers(context.user, {
        filters: { status: 'Active' },
        fields: ['id', 'userId', 'fullName', 'email', 'role', 'segment', 'isPrabhupadaWorldUser', 'isBvAdmin', 'isBvSuperAdmin', 'folkResidencies'],
        limit: 2000,
      }),
      readScopedUsers(context.user, {
        filters: { residencyApproved: true, status: 'Active' } as any,
        fields: ['id', 'residency', 'guide'],
        limit: 2000,
      }),
    ]);

    const residencies = allResidencies.filter(r => hierarchy === null || guideScope?.residencyIds.includes(r.id));
    const guides = allGuides.filter(u => isUserInHierarchy(u, hierarchy));
    const residents = allResidents.filter(u => isUserInHierarchy(u, hierarchy));
    const normalizeRole = (value: unknown) => String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
    const userGuideRecords = (userGuideRows as any[]).filter((u: any) => {
      if (!isUserInHierarchy(u, hierarchy)) return false;
      const role = normalizeRole(u.role);
      const isPw = String(u.segment || '').trim().toUpperCase() === 'PW' || u.isPrabhupadaWorldUser === true;
      const isGuide = ['GUIDE', 'SUPER_GUIDE', 'ADMIN', 'SUPER_ADMIN'].includes(role) || u.isBvAdmin === true || u.isBvSuperAdmin === true;
      return !isPw && isGuide;
    }).map((u: any) => ({
      ...u,
      id: u.id || u.userId,
      guideId: u.userId || u.id,
      abbreviation: u.abbreviation || String(u.fullName || '').slice(0, 3).toUpperCase(),
    }));
    const allGuideRecords = [...(guides as any[]), ...userGuideRecords];

    const residencyByRef = new Map<string, any>();
    for (const residency of residencies as any[]) {
      for (const ref of [residency.id, residency.residencyId, residency.residencyName]) {
        if (ref) residencyByRef.set(String(ref).trim().toLowerCase(), residency);
      }
    }

    const guideByRef = new Map<string, any>();
    for (const guide of allGuideRecords as any[]) {
      for (const ref of [guide.id, guide.guideId, guide.fullName, guide.email, guide.abbreviation]) {
        if (ref) guideByRef.set(String(ref).trim().toLowerCase(), guide);
      }
    }

    const resolveResidencyId = (value: unknown): string | null => {
      const match = residencyByRef.get(String(value || '').trim().toLowerCase());
      return match?.id ? String(match.id) : null;
    };

    const addGuide = (map: Map<string, any[]>, residencyId: string, guide: any) => {
      if (!residencyId || !guide?.id) return;
      if (!map.has(residencyId)) map.set(residencyId, []);
      const list = map.get(residencyId)!;
      const guideEmail = String(guide.email || '').trim().toLowerCase();
      if (list.some((entry: any) => entry.recordId === guide.id ||
        entry.guideId === guide.id ||
        (guideEmail && String(entry.email || '').trim().toLowerCase() === guideEmail))) return;
      list.push({
        guideId: guide.id,
        guideName: guide.fullName || '',
        abbreviation: guide.abbreviation || '',
        recordId: guide.id,
        email: guide.email || '',
      });
    };

    // Build residency → guides array map. New records use guideIds; legacy
    // imports use a comma-separated guides field or guide folkResidencies.
    // Each entry includes recordId (Guides table UUID) for matching against User.guide
    const residencyGuideMap = new Map<string, Array<{ guideId: string; guideName: string; abbreviation: string; recordId: string; email?: string }>>();
    for (const g of allGuideRecords as any[]) {
      for (const value of (Array.isArray(g.folkResidencies) ? g.folkResidencies : g.folkResidencies ? [g.folkResidencies] : [])) {
        const rid = resolveResidencyId(value);
        if (rid) addGuide(residencyGuideMap, rid, g);
      }
    }
    for (const residency of residencies as any[]) {
      const rid = String(residency.id || '');
      const refs = [
        ...((Array.isArray(residency.guideIds) ? residency.guideIds : residency.guideIds ? [residency.guideIds] : [])),
        ...((Array.isArray(residency.guides) ? residency.guides : String(residency.guides || '').split(','))),
      ];
      for (const ref of refs) {
        const guide = guideByRef.get(String(ref || '').trim().toLowerCase());
        if (guide) addGuide(residencyGuideMap, rid, guide);
      }
    }

    // Build residencyId → Set<userId> (approved residents only)
    const residencyUserMap = new Map<string, Set<string>>();
    // Build userId → residencyId reverse map (for entry lookup)
    const userResidencyMap = new Map<string, string>();
    for (const u of residents) {
      const rawRid = Array.isArray(u.residency) ? u.residency[0] : u.residency as string;
      const rid = resolveResidencyId(rawRid);
      if (!rid) continue;
      if (!residencyUserMap.has(rid)) residencyUserMap.set(rid, new Set());
      residencyUserMap.get(rid)!.add(u.id);
      userResidencyMap.set(u.id, rid);
    }

    // Build residencyId → guideRecordId → resident count
    const residencyGuideUserCount = new Map<string, Map<string, number>>();
    for (const u of residents) {
      const rawRid = Array.isArray(u.residency) ? u.residency[0] : u.residency as string;
      const rid = resolveResidencyId(rawRid);
      if (!rid) continue;
      const rawGuide = Array.isArray(u.guide) ? u.guide[0] : u.guide as string;
      const guideRecordId = guideByRef.get(String(rawGuide || '').trim().toLowerCase())?.id || rawGuide;
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

    return residencies.filter((r: any) => !isPrabhupadaWorldResidency(r)).map((r: any) => {
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
        assignedGuideIds: enrichedGuides.map((g: any) => g.recordId),
        residentCount,
        monthlyAvgs,
        quarterAvg,
      };
    });
  },
});
