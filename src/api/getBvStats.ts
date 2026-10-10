import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { scopeRealtimeDependencies } from '@/lib/requestQueries';
import { createEndpoint, AppError, Users, Guides, BvslPreachingEntries, SadhanaEntries } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { bvUserAliases, isBvDepartmentAdmin, isBvSuperAdminUser, resolveBvDepartmentFacilitatorUsers, resolveBvGroupFacilitatorUsers, resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';
import { normaliseMemberBvActivity } from '../lib/bvMemberActivity';
import { serverCacheGetOrFetch } from '../lib/serverCache';

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
    groupId: z.string().optional(),
    /** Optional selected facilitator, always verified against the caller's scoped hierarchy. */
    subjectUserId: z.string().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerSegment = String((context.user as any).segment || 'FOLK').toUpperCase();
    const cacheKey = `bvStats:${input.guideId}:${input.startDate}:${input.endDate}:${input.bvslMode ? '1' : '0'}:${input.groupId || ''}:${input.subjectUserId || ''}:${(input.residencyIds || []).sort().join(',')}:${input.segment || callerSegment}:${context.user.id}`;
    return serverCacheGetOrFetch(cacheKey, () => _fetchBvStats({ input, context }), 5 * 60 * 1000);
  },
});

async function _fetchBvStats({ input, context }: { input: any; context: any }) {
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: context.user.isBvMentor,
      isBvSupervisor: context.user.isBvSupervisor,
      isBvAdmin: context.user.isBvAdmin,
      isBvSuperAdmin: context.user.isBvSuperAdmin,
      isBvSubFacilitator: context.user.isBvSubFacilitator,
    });
    const { guideId, startDate, endDate, bvslMode, residencyIds, groupId, subjectUserId, segment } = input;

    let bvslUsers: any[] = [];

    const isSupervisorMode = !!bvslMode && !!(context.user.isBvSupervisor || context.user.isBvMentor);
    const isMemberMode = !!bvslMode && !isSupervisorMode;
    if (guideId === 'ALL' && segment && isBvSuperAdminUser(context.user as any)) {
      if (!isBvSuperAdminUser(context.user as any)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Department-wide BV reports require super admin access' });
      }
      bvslUsers = await resolveBvDepartmentFacilitatorUsers(
        segment,
        ['id', 'userId', 'email', 'fullName'],
        groupId,
      );
    } else if (isBvDepartmentAdmin(context.user as any) && !isBvSuperAdminUser(context.user as any)) {
      bvslUsers = await resolveBvGroupFacilitatorUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName'],
        { segment, groupId },
      );
    } else if (isSupervisorMode) {
      const rawSegment = String(context.user.segment || 'FOLK').toUpperCase();
      const segment = rawSegment === 'PW' ? 'PW' : 'FOLK';
      bvslUsers = await resolveBvGroupFacilitatorUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName'],
        { segment, groupId },
      );
    } else if (bvslMode) {
      // An RGF monitors the members of their facilitated groups. Their own
      // Sadhana/preaching entry must not become the group report subject.
      const rawSegment = String(context.user.segment || '').toUpperCase();
      const segment = rawSegment === 'FOLK' || rawSegment === 'PW' ? rawSegment as 'FOLK' | 'PW' : undefined;
      bvslUsers = await resolveBvGroupMemberUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName'],
        { segment, groupId, excludeCaller: true },
      );
    } else if (residencyIds && residencyIds.length > 0) {
      // Center-based scoping from explicit residencyIds (BV Mentor context)
      const { getGuideIdsForResidencies } = await import('../lib/guideScope');
      const allGuideIds = await getGuideIdsForResidencies(residencyIds);
      const bvslMap = new Map<string, any>();
      if (allGuideIds.length > 0) {
        const fetches = await Promise.all(allGuideIds.map(gid =>
          readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active', guide: gid }, fields: ['id', 'userId', 'fullName'], limit: 200 })
        ));
        for (const res of fetches) for (const u of res.records) bvslMap.set(u.id, u);
      }
      const resFetches = await Promise.all(residencyIds.map((rid: string) =>
        readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName'], limit: 200 })
      ));
      for (const res of resFetches) for (const u of res.records) bvslMap.set(u.id, u);
      bvslUsers = Array.from(bvslMap.values());
    } else {
      const guideDbId = guideId === 'ALL' ? null : guideId;
      if (guideDbId) {
        // Fetch BVSL users: directly assigned to guide + from guide's center residencies
        const { records: guideAssigned } = await readScopedUsers(context.user, {
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
              readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName'], limit: 100 })
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
        const { records } = await readScopedUsers(context.user, {
          filters: { isBvsl: true, status: 'Active' },
          fields: ['id', 'userId', 'fullName'],
          limit: 200,
        });
        bvslUsers = records;
      }
    }

    const hierarchy = await getScopedHierarchyUserIds(context.user);
    bvslUsers = bvslUsers.filter(user => isUserInHierarchy(user, hierarchy));

    // The individual trend view is allowed only for a facilitator already
    // resolved by the caller's scope above. This keeps supervisor reporting
    // strictly within their own hierarchy.
    if (subjectUserId) {
      const requestedUserId = String(subjectUserId).trim().toLowerCase();
      bvslUsers = bvslUsers.filter(user =>
        bvUserAliases(user).some(alias => alias === requestedUserId)
      );
    }

    if (bvslUsers.length === 0) {
      return {
        subjectType: isMemberMode ? 'members' : 'facilitators',
        dailyTrend: [],
        userSummaries: [],
        totalUsers: 0,
        totalSubmitted: 0,
      };
    }

    const canonicalByAlias = new Map<string, string>();
    bvslUsers.forEach(user => {
      bvUserAliases(user).forEach(alias => canonicalByAlias.set(alias, user.id));
    });

    scopeRealtimeDependencies(isMemberMode ? 'SadhanaEntries' : 'BvslPreachingEntries', { kind: 'references', fields: ['user'], values: [...canonicalByAlias.keys()] });
    let allEntries: any[] = [];
    let offset = 0;
    const entryDateFilter = startDate === endDate
      ? startDate
      : { gte: startDate, lte: endDate };
    while (true) {
      const source = isMemberMode ? SadhanaEntries : BvslPreachingEntries;
      const { records, hasMore } = await source.findAll({
        filters: { entryDate: entryDateFilter } as any,
        fields: isMemberMode
          ? ['id', 'user', 'entryDate', 'preachingMinutes', 'booksDistributed', 'fieldValuesJson', 'submittedAt']
          : undefined,
        limit: 2000,
        offset,
      });
      allEntries = allEntries.concat(isMemberMode ? records.map(normaliseMemberBvActivity) : records);
      if (!hasMore) break;
      offset += 2000;
    }

    const filteredEntries = allEntries.flatMap(entry => {
      const entryAliases = (Array.isArray(entry.user) ? entry.user : [entry.user])
        .filter(Boolean).map((value: unknown) => String(value).toLowerCase());
      const canonicalId = entryAliases.map((alias: string) => canonicalByAlias.get(alias)).find(Boolean);
      return canonicalId ? [{ ...entry, __canonicalUserId: canonicalId }] : [];
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
      const uid = e.__canonicalUserId as string;
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
      subjectType: isMemberMode ? 'members' : 'facilitators',
      dailyTrend,
      userSummaries: userSummaries.sort((a, b) => b.avgTotalPreachingMinutes - a.avgTotalPreachingMinutes),
      totalUsers: bvslUsers.length,
      totalSubmitted: filteredEntries.length,
    };
}
