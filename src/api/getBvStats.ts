import { z } from 'zod';
import { createEndpoint, Users, Guides, BvslPreachingEntries, BvGroups, BvGroupMembers } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

const BV_FIELDS = [
  'prCallingTime', 'prOneOnOneTime', 'prBookDistTime', 'prRduaTime', 'prPlanTime',
  'prBooksDistributed', 'prContactsCollected', 'prUniqueOneOnOnes', 'totalPreachingMinutes',
];

export default createEndpoint({
  description: 'Aggregate BV preaching stats for a guide over a date range',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    bvslMode: z.boolean().optional(),
    residencyIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor: (context.user as any).isBvMentor });
    const { guideId, startDate, endDate, bvslMode, residencyIds } = input;

    let bvslUsers: any[] = [];

    if (bvslMode) {
      // Show BVSLs from the current user's groups
      const { records: myGroups } = await BvGroups.findAll({
        filters: { bvslLeader: context.user.id, isActive: true } as any,
        fields: ['id'],
        limit: 100,
      });
      if (myGroups.length > 0) {
        const groupIds = myGroups.map((g: any) => g.id);
        const { records: memberships } = await BvGroupMembers.findAll({
          filters: { group: { in: groupIds } } as any,
          fields: ['id', 'user'],
          limit: 2000,
        });
        const memberIds = [...new Set(memberships.map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user).filter(Boolean))];
        if (memberIds.length > 0) {
          const { records } = await Users.findAll({
            filters: { id: { in: memberIds as any }, status: 'Active' } as any,
            fields: ['id', 'userId', 'fullName'],
            limit: 500,
          });
          bvslUsers = records;
        }
      }
    } else if (residencyIds && residencyIds.length > 0) {
      // Center-based scoping from explicit residencyIds (BV Mentor context)
      const { getGuideIdsForResidencies } = await import('../lib/guideScope');
      const allGuideIds = await getGuideIdsForResidencies(residencyIds);
      const bvslMap = new Map<string, any>();
      if (allGuideIds.length > 0) {
        const fetches = await Promise.all(allGuideIds.map(gid =>
          Users.findAll({ filters: { isBvsl: true, status: 'Active', guide: gid }, fields: ['id', 'userId', 'fullName'], limit: 200 })
        ));
        for (const res of fetches) for (const u of res.records) bvslMap.set(u.id, u);
      }
      const resFetches = await Promise.all(residencyIds.map(rid =>
        Users.findAll({ filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName'], limit: 200 })
      ));
      for (const res of resFetches) for (const u of res.records) bvslMap.set(u.id, u);
      bvslUsers = Array.from(bvslMap.values());
    } else {
      const guideDbId = guideId === 'ALL' ? null : guideId;
      if (guideDbId) {
        // Fetch BVSL users: directly assigned to guide + from guide's center residencies
        const { records: guideAssigned } = await Users.findAll({
          filters: { isBvsl: true, status: 'Active', guide: guideDbId },
          fields: ['id', 'userId', 'fullName'],
          limit: 200,
        });
        const guide = await Guides.findOne({ id: guideDbId, fields: ['id', 'folkResidencies'] });
        const rids: string[] = Array.isArray(guide?.folkResidencies)
          ? guide!.folkResidencies as string[]
          : (guide?.folkResidencies ? [guide!.folkResidencies as string] : []);
        const centerFetches = rids.length > 0
          ? await Promise.all(rids.map(rid =>
              Users.findAll({ filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName'], limit: 100 })
            ))
          : [];
        const bvslMap = new Map<string, any>();
        for (const u of guideAssigned) bvslMap.set(u.id, u);
        for (const res of centerFetches) {
          for (const u of res.records) bvslMap.set(u.id, u);
        }
        bvslUsers = Array.from(bvslMap.values());
      } else {
        // ALL = show every BVSL
        const { records } = await Users.findAll({
          filters: { isBvsl: true, status: 'Active' },
          fields: ['id', 'userId', 'fullName'],
          limit: 200,
        });
        bvslUsers = records;
      }
    }

    if (bvslUsers.length === 0) {
      return { dailyTrend: [], userSummaries: [], totalUsers: 0 };
    }

    const bvslDbIds = bvslUsers.map(u => u.id);

    let allEntries: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await BvslPreachingEntries.findAll({
        filters: { entryDate: { gte: startDate, lte: endDate } } as any,
        limit: 2000,
        offset,
      });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    const filteredEntries = allEntries.filter(e => {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      return uid && bvslDbIds.includes(uid as string);
    });

    // Daily trend
    const byDate = new Map<string, { sums: Record<string, number>; count: number }>();
    for (const e of filteredEntries) {
      const date = (e.entryDate as string || '').slice(0, 10);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { sums: {}, count: 0 });
      const agg = byDate.get(date)!;
      agg.count++;
      for (const f of BV_FIELDS) {
        agg.sums[f] = (agg.sums[f] || 0) + (Number((e as any)[f]) || 0);
      }
    }

    const dailyTrend: any[] = [];
    const cur = new Date(startDate + 'T00:00:00');
    const endD = new Date(endDate + 'T00:00:00');
    while (cur <= endD) {
      const ds = cur.toISOString().split('T')[0];
      const d = byDate.get(ds);
      const point: any = {
        date: ds,
        label: new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        submittedCount: d?.count ?? 0,
      };
      for (const f of BV_FIELDS) {
        point[f] = d && d.count > 0 ? Math.round(d.sums[f] / d.count * 10) / 10 : null;
      }
      dailyTrend.push(point);
      cur.setDate(cur.getDate() + 1);
    }

    // Per-user summaries
    const entriesByUser = new Map<string, any[]>();
    for (const e of filteredEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(e);
    }

    const totalDays = Math.max(1, dailyTrend.length);
    const userSummaries = bvslUsers.map(u => {
      const ue = entriesByUser.get(u.id) || [];
      const submitted = ue.length;
      const avgPreaching = submitted > 0
        ? Math.round(ue.reduce((s: number, e: any) => s + (Number(e.totalPreachingMinutes) || 0), 0) / submitted)
        : 0;
      return {
        userId: u.userId || u.id,
        fullName: u.fullName || '',
        submittedCount: submitted,
        totalDays,
        avgTotalPreachingMinutes: avgPreaching,
      };
    });

    return {
      dailyTrend,
      userSummaries: userSummaries.sort((a, b) => b.avgTotalPreachingMinutes - a.avgTotalPreachingMinutes),
      totalUsers: bvslUsers.length,
      totalSubmitted: filteredEntries.length,
    };
  },
});
