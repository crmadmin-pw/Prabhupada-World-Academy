

import { z } from 'zod';
import { createEndpoint, Users, BvslPreachingEntries, Guides, BvGroups, FolkResidencies } from '@/lib/backend-sdk';
import { requireGuideRole, getRefId } from '../lib/userUtils';
import getGuides from './getGuides';
import { getScopedHierarchyUserIds, isUserInHierarchy, hierarchyAliases, hierarchyRefs, isHierarchyAdmin, readScopedUsers } from '../lib/hierarchyUtils';

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
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const { date, reportType, startDate, endDate } = input;
    const effectiveStart = (startDate || date || '').split('T')[0];
    const effectiveEnd   = (endDate   || date || '').split('T')[0];
    if (!effectiveStart) throw new Error('Invalid date');

    const emptyAgg = () => Object.fromEntries(NUM_KEYS.map(k => [k, 0]));

    // Fetch guides, users, residencies, and groups in parallel
    const [
      guidesRes,
      { records: allUserRecs },
      { records: guideRecs },
      { records: folkResRecs },
      { records: bvslCandidates },
      { records: bvGroups },
    ] = await Promise.all([
      getGuides.execute({ input: {}, context }),
      readScopedUsers(context.user, { fields: ['id', 'userId', 'fullName', 'email', 'role', 'segment', 'residency', 'guide', 'isBvAdmin', 'isBvSuperAdmin', 'bvReportingAdminId', 'bvSupervisorGuideId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId'], limit: 2000 }),
      Guides.findAll({ fields: ['id', 'guideId', 'fullName', 'name', 'abbreviation', 'folkResidencies', 'email'], limit: 500 }),
      FolkResidencies.findAll({ fields: ['id', 'residencyId', 'residencyName', 'guide', 'guideName'], limit: 200 }),
      readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active' }, fields: ['id', 'userId', 'fullName', 'email', 'guide', 'residency', 'segment', 'isPrabhupadaWorldUser'], limit: 500 }),
      BvGroups.findAll({ filters: { isActive: true }, fields: ['id', 'groupName', 'bvslLeader', 'guide', 'guideName', 'bvReportingAdminName', 'center'], limit: 500 }),
    ]);

    const hierarchy = await getScopedHierarchyUserIds(context.user);
    const bvslUsers = bvslCandidates.filter(user => isUserInHierarchy(user, hierarchy));
    if (bvslUsers.length === 0) {
      return { centers: [], overall: { bvslCount: 0, submittedCount: 0, totals: emptyAgg(), avgs: emptyAgg() } };
    }

    // 1. Build Residencies Map
    const residencyMap = new Map<string, string>();
    for (const r of folkResRecs) {
      const name = (r as any).residencyName || (r as any).name || '';
      if (name) {
        if (r.id) {
          residencyMap.set(r.id, name);
          residencyMap.set(r.id.toLowerCase(), name);
        }
        if ((r as any).residencyId) {
          residencyMap.set((r as any).residencyId, name);
          residencyMap.set((r as any).residencyId.toLowerCase(), name);
        }
      }
    }

    // 2. Build Comprehensive Guide & Center Lookup Map
    const guideNameMap = new Map<string, string>();

    // From getGuides endpoint
    for (const g of (guidesRes.guides || [])) {
      if (g.guideId && g.name && !g.name.includes('Unknown')) {
        guideNameMap.set(g.guideId, g.name);
        guideNameMap.set(g.guideId.toLowerCase(), g.name);
      }
    }

    // From Guides table
    for (const g of guideRecs) {
      const name = g.fullName || (g as any).name || (g as any).abbreviation || '';
      if (name && !name.includes('Unknown')) {
        if (g.id) {
          guideNameMap.set(g.id, name);
          guideNameMap.set(g.id.toLowerCase(), name);
        }
        if ((g as any).guideId) {
          guideNameMap.set((g as any).guideId, name);
          guideNameMap.set((g as any).guideId.toLowerCase(), name);
        }
        if ((g as any).abbreviation) {
          guideNameMap.set((g as any).abbreviation, name);
          guideNameMap.set((g as any).abbreviation.toLowerCase(), name);
        }
        if (g.email) {
          guideNameMap.set(g.email.toLowerCase(), name);
        }
      }

      // Map linked residencies to guide
      const fRes = Array.isArray((g as any).folkResidencies)
        ? (g as any).folkResidencies
        : typeof (g as any).folkResidencies === 'string'
        ? (g as any).folkResidencies.split(',').map((s: string) => s.trim())
        : [];
      for (const rid of fRes) {
        if (rid && name && !name.includes('Unknown') && !guideNameMap.has(rid)) {
          guideNameMap.set(rid, name);
        }
      }
    }

    // From Users table
    for (const u of allUserRecs) {
      if (u.fullName && !u.fullName.includes('Unknown')) {
        if (u.id) {
          guideNameMap.set(u.id, u.fullName);
          guideNameMap.set(u.id.toLowerCase(), u.fullName);
        }
        if (u.userId) {
          guideNameMap.set(u.userId, u.fullName);
          guideNameMap.set(u.userId.toLowerCase(), u.fullName);
        }
        if (u.email) {
          guideNameMap.set(u.email.toLowerCase(), u.fullName);
        }
      }
    }

    // 3. BV group name & admin lookup per BVSL leader
    const groupByBvsl = new Map<string, string>();
    const groupAdminByBvsl = new Map<string, string>();
    for (const g of bvGroups) {
      const lid = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader;
      if (lid) {
        groupByBvsl.set(lid as string, g.groupName || '');
        const adminName = (g as any).bvReportingAdminName || (g as any).guideName || '';
        if (adminName) groupAdminByBvsl.set(lid as string, adminName);
      }
    }

    // Function to safely resolve Guide / Center display name for a BVSL
    const resolveCenterName = (u: any): { key: string; name: string } => {
      // PW analytics are grouped by the reporting Admin, including RGFs
      // linked indirectly through a supervisor instead of Users.guide.
      if (String(u.segment || '').toUpperCase() === 'PW' || u.isPrabhupadaWorldUser) {
        let parent = allUserRecs.find(record => record.id === u.id);
        const visited = new Set<string>();
        while (parent && !visited.has(parent.id)) {
          visited.add(parent.id);
          if (isHierarchyAdmin(parent)) return { key: parent.userId || parent.id, name: parent.fullName || '' };
          const refs = hierarchyRefs(parent.bvReportingAdminId || parent.bvSupervisorGuideId || parent.bvReportingSupervisorId || parent.bvReportingFacilitatorId || parent.guide);
          parent = allUserRecs.find(record => hierarchyAliases(record).some(alias => refs.includes(alias)));
        }
      }
      const rawGid = getRefId(u.guide);
      const rawRid = getRefId(u.residency);

      // Check direct guide match
      if (rawGid) {
        const directName = guideNameMap.get(rawGid) || guideNameMap.get(rawGid.toLowerCase());
        if (directName && !directName.includes('Unknown')) {
          return { key: rawGid, name: directName };
        }
        const resName = residencyMap.get(rawGid) || residencyMap.get(rawGid.toLowerCase());
        if (resName) {
          return { key: rawGid, name: resName };
        }
      }

      // Check residency match
      if (rawRid) {
        const resName = residencyMap.get(rawRid) || residencyMap.get(rawRid.toLowerCase());
        if (resName) {
          return { key: rawRid, name: resName };
        }
        const guideForRes = guideNameMap.get(rawRid) || guideNameMap.get(rawRid.toLowerCase());
        if (guideForRes && !guideForRes.includes('Unknown')) {
          return { key: rawRid, name: guideForRes };
        }
      }

      // Check BV group admin name
      const grpAdmin = groupAdminByBvsl.get(u.id);
      if (grpAdmin && !grpAdmin.includes('Unknown')) {
        return { key: grpAdmin, name: grpAdmin };
      }

      // Segment fallback
      const uSeg = (u.segment || '').toUpperCase();
      if (uSeg === 'PW' || u.isPrabhupadaWorldUser) {
        return { key: u.id, name: u.fullName || 'Unassigned' };
      }

      return { key: u.id, name: u.fullName || 'Unassigned' };
    };

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

    // Group BVSLs by resolved center/guide
    const byCenter = new Map<string, { guideId: string; guideName: string; users: any[] }>();
    for (const u of bvslUsers) {
      const { key, name } = resolveCenterName(u);
      if (!byCenter.has(name)) {
        byCenter.set(name, { guideId: key, guideName: name, users: [] });
      }
      byCenter.get(name)!.users.push(u);
    }

    const centers = [...byCenter.values()].map(group => {
      const rows = group.users.map(buildRow).sort((a, b) => b.totalMinutes - a.totalMinutes);
      const { totals, avgs } = makeAgg(rows);
      return {
        guideId: group.guideId,
        guideName: group.guideName,
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
