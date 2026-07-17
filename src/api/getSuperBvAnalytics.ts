import { z } from 'zod';
import { createEndpoint, Users, BvslPreachingEntries, Guides, BvGroups } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

const NUM_KEYS = [
  'callingTime', 'oneOnOneTime', 'bookDistTime', 'rduaTime', 'planTime',
  'booksDistributed', 'contactsCollected', 'uniqueOneOnOnes', 'totalMinutes',
] as const;

const IS_COUNT_KEY = (k: string) =>
  ['booksDistributed', 'contactsCollected', 'uniqueOneOnOnes'].includes(k);

function makeAgg(rows: any[]) {
  const submitted = rows.filter((r: any) => r.submitted);
  const n = Math.max(submitted.length, 1);
  const totals: any = {};
  const avgs: any = {};
  for (const k of NUM_KEYS) {
    totals[k] = submitted.reduce((s: number, r: any) => s + (Number(r[k]) || 0), 0);
    avgs[k] = IS_COUNT_KEY(k)
      ? Math.round(totals[k] / n * 10) / 10
      : Math.round(totals[k] / n);
  }
  return { totals, avgs };
}

export default createEndpoint({
  description: 'Super guide BV preaching analytics — center-wise aggregates + individual BVSL details',
  authenticated: true,
  inputSchema: z.object({
    date: z.string().optional(),
    reportType: z.enum(['daily', 'weekly', 'monthly']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const { date, reportType, startDate, endDate } = input;
    const effectiveStart = (startDate || date || '').split('T')[0];
    const effectiveEnd   = (endDate   || date || '').split('T')[0];
    if (!effectiveStart) throw new Error('Invalid date');

    const emptyAgg = () => Object.fromEntries(NUM_KEYS.map(k => [k, 0]));

    // Fetch guides for name lookup
    const { records: guideRecs } = await Guides.findAll({
      filters: { isActive: true }, fields: ['id', 'fullName'], limit: 200,
    });
    const guideNameMap = new Map<string, string>(guideRecs.map(g => [g.id, g.fullName || '']));

    // Fetch all active BVSLs with their guide reference
    const { records: bvslUsers } = await Users.findAll({
      filters: { isBvsl: true, status: 'Active' },
      fields: ['id', 'fullName', 'guide'],
      limit: 500,
    });

    if (bvslUsers.length === 0) {
      return { centers: [], overall: { bvslCount: 0, submittedCount: 0, totals: emptyAgg(), avgs: emptyAgg() } };
    }

    // BV group name lookup per BVSL
    const { records: bvGroups } = await BvGroups.findAll({
      filters: { isActive: true }, fields: ['groupName', 'bvslLeader'], limit: 500,
    });
    const groupByBvsl = new Map<string, string>();
    for (const g of bvGroups) {
      const lid = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader;
      if (lid) groupByBvsl.set(lid as string, g.groupName || '');
    }

    // Fetch preaching entries for the date range
    const dateFilter: any = reportType === 'daily'
      ? { entryDate: effectiveStart }
      : { entryDate: { gte: effectiveStart, lte: effectiveEnd } };

    let allEntries: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await BvslPreachingEntries.findAll({ filters: dateFilter, limit: 2000, offset });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    const bvslIdSet = new Set(bvslUsers.map(u => u.id));
    const entriesByUser = new Map<string, any[]>();
    for (const e of allEntries) {
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
      if (uid && bvslIdSet.has(uid)) {
        if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
        entriesByUser.get(uid)!.push(e);
      }
    }

    const isDaily = reportType === 'daily';
    const sumF = (entries: any[], field: string) =>
      isDaily ? Number(entries[0]?.[field] ?? 0) : entries.reduce((s, e) => s + (Number(e[field]) || 0), 0);

    const buildRow = (u: any) => {
      const entries = entriesByUser.get(u.id) || [];
      const submitted = entries.length > 0;
      return {
        id: u.id, fullName: u.fullName || '', groupName: groupByBvsl.get(u.id) || '—', submitted,
        callingTime:      submitted ? sumF(entries, 'prCallingTime')       : 0,
        oneOnOneTime:     submitted ? sumF(entries, 'prOneOnOneTime')      : 0,
        bookDistTime:     submitted ? sumF(entries, 'prBookDistTime')      : 0,
        rduaTime:         submitted ? sumF(entries, 'prRduaTime')          : 0,
        planTime:         submitted ? sumF(entries, 'prPlanTime')          : 0,
        booksDistributed: submitted ? sumF(entries, 'prBooksDistributed')  : 0,
        contactsCollected:submitted ? sumF(entries, 'prContactsCollected') : 0,
        uniqueOneOnOnes:  submitted ? sumF(entries, 'prUniqueOneOnOnes')   : 0,
        totalMinutes:     submitted ? sumF(entries, 'totalPreachingMinutes'): 0,
      };
    };

    // Group BVSLs by guide
    const byGuide = new Map<string, any[]>();
    for (const u of bvslUsers) {
      const gid = (Array.isArray(u.guide) ? u.guide[0] : (u.guide as string)) || '_unknown';
      if (!byGuide.has(gid)) byGuide.set(gid, []);
      byGuide.get(gid)!.push(u);
    }

    const centers = [...byGuide.entries()].map(([guideId, users]) => {
      const rows = users.map(buildRow).sort((a, b) => b.totalMinutes - a.totalMinutes);
      const { totals, avgs } = makeAgg(rows);
      return {
        guideId,
        guideName: guideNameMap.get(guideId) || 'Unknown Guide',
        bvslCount: rows.length,
        submittedCount: rows.filter(r => r.submitted).length,
        totals, avgs, bvsls: rows,
      };
    }).sort((a, b) => b.totals.totalMinutes - a.totals.totalMinutes);

    const allRows = centers.flatMap(c => c.bvsls);
    const { totals, avgs } = makeAgg(allRows);
    return {
      centers,
      overall: {
        bvslCount: allRows.length,
        submittedCount: allRows.filter((r: any) => r.submitted).length,
        totals, avgs,
      },
    };
  },
});
