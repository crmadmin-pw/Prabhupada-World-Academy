import { z } from 'zod';
import { getScopedHierarchyUserIds, isPwDepartmentAdmin, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { scopeRealtimeDependencies } from '@/lib/requestQueries';
import { createEndpoint, AppError, Users, BvslPreachingEntries, BvGroups, Guides, SadhanaEntries } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideIdsForResidencies } from '../lib/guideScope';
import { bvUserAliases, isBvDepartmentAdmin, isBvSuperAdminUser, resolveBvDepartmentFacilitatorUsers, resolveBvDepartmentGroups, resolveBvGroupFacilitatorUsers, resolveBvGroupMemberUsers, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { normaliseMemberBvActivity } from '../lib/bvMemberActivity';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { collectOwnerKeys, readEntriesForOwners } from '../lib/scopedEntryReads';

function isFolkMemberLevelFacilitator(user: any): boolean {
  const role = String(user?.role || '').toUpperCase().replace(/\s+/g, '_');
  return !(
    user?.isBvAdmin ||
    user?.isBvSuperAdmin ||
    role === 'GUIDE' ||
    role === 'SUPER_GUIDE' ||
    role === 'SUPER_ADMIN' ||
    role === 'PW_ADMIN' ||
    role === 'ADMIN'
  );
}

export default createEndpoint({
  description: 'BV preaching report for guide — all BVSLs under guide with preaching entries',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    date: z.string(),
    reportType: z.enum(['daily', 'weekly', 'monthly']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    bvslMode: z.boolean().optional(),
    groupId: z.string().optional(),
    residencyIds: z.array(z.string()).optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
    supervisionOnly: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');

    // Cache key encodes every dimension that affects the result. TTL = 5 min.
    // The cache is invalidated globally by assignBvRole and other mutation
    // endpoints via serverCacheInvalidate().
    const callerSegment = String((context.user as any).segment || 'FOLK').toUpperCase();
    const cacheKey = `bvPreachingReport:${input.guideId}:${input.date}:${input.reportType}:${input.startDate || ''}:${input.endDate || ''}:${input.bvslMode ? '1' : '0'}:${input.groupId || ''}:${(input.residencyIds || []).sort().join(',')}:${input.segment || callerSegment}:${context.user.id}`;
    return serverCacheGetOrFetch(cacheKey, () => _fetchBvPreachingReport({ input, context }), 5 * 60 * 1000);
  },
});

async function _fetchBvPreachingReport({ input, context }: { input: any; context: any }) {
  const isBvMentor = !!(context.user as any).isBvMentor;
  if (!input.bvslMode && !isBvMentor) requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor });

  const { guideId: inputGuideId, date, reportType, startDate, endDate, bvslMode, groupId, residencyIds, segment } = input;
  const effectiveStart = (startDate || date || '').split('T')[0];
  const effectiveEnd = (endDate || date || '').split('T')[0];
  if (!effectiveStart) throw new Error('Invalid date');

    let guideDbId: string | null = inputGuideId === 'ALL' ? null : inputGuideId;

    // Robust guide ID resolution: resolve Users-table UUID → Guides-table UUID
    if (guideDbId) {
      const directGuideRec = await Guides.findOne({ id: guideDbId, fields: ['id'] });
      if (!directGuideRec) {
        const guideUser = await Users.findOne({ id: guideDbId, fields: ['id', 'email'] });
        if (guideUser?.email) {
          const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
          if (guideByEmail) guideDbId = guideByEmail.id;
        }
        if (guideDbId === inputGuideId) {
          const guideByCustomId = await Guides.findOne({ filters: { guideId: guideDbId }, fields: ['id'] });
          if (guideByCustomId) guideDbId = guideByCustomId.id;
        }
      }
    }

    const isSupervisorMode = !!bvslMode && !!(context.user.isBvSupervisor || context.user.isBvMentor);
    const isMemberMode = !!bvslMode && !isSupervisorMode;
    let hierarchyGroups: any[] | null = null;
    let bvslUsers: any[] = [];
    if (inputGuideId === 'ALL' && segment && isBvSuperAdminUser(context.user as any)) {
      if (!isBvSuperAdminUser(context.user as any)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Department-wide BV reports require super admin access' });
      }
      hierarchyGroups = (await resolveBvDepartmentGroups(segment, groupId)).map(group => group.record);
      bvslUsers = await resolveBvDepartmentFacilitatorUsers(
        segment,
        ['id', 'userId', 'email', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'isBvSubFacilitator'],
        groupId,
      );
    } else if (isBvDepartmentAdmin(context.user as any) && !isBvSuperAdminUser(context.user as any)) {
      hierarchyGroups = (await resolveBvScopedGroups(context.user as any, { segment, groupId, supervisionOnly: input.supervisionOnly === true }))
        .map(group => group.record);
      bvslUsers = await resolveBvGroupFacilitatorUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'isBvSubFacilitator'],
        { segment, groupId, supervisionOnly: input.supervisionOnly === true },
      );
    } else if (isSupervisorMode) {
      const rawSegment = String(context.user.segment || 'FOLK').toUpperCase();
      const segment = rawSegment === 'PW' ? 'PW' : 'FOLK';
      hierarchyGroups = (await resolveBvScopedGroups(context.user as any, { segment, groupId, supervisionOnly: input.supervisionOnly === true }))
        .map(group => group.record);
      bvslUsers = await resolveBvGroupFacilitatorUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin', 'isBvSubFacilitator'],
        { segment, groupId, supervisionOnly: input.supervisionOnly === true },
      );
    } else if (bvslMode) {
      // RGF reports belong to the facilitated groups and their members, not
      // to the signed-in RGF's own Sadhana/preaching record.
      const rawSegment = String(context.user.segment || '').toUpperCase();
      const segment = rawSegment === 'FOLK' || rawSegment === 'PW' ? rawSegment as 'FOLK' | 'PW' : undefined;
      hierarchyGroups = (await resolveBvScopedGroups(context.user as any, { segment, groupId, supervisionOnly: input.supervisionOnly === true }))
        .map(group => group.record);
      bvslUsers = await resolveBvGroupMemberUsers(
        context.user as any,
        ['id', 'userId', 'email', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone'],
        { segment, groupId, excludeCaller: true },
      );
    } else if (residencyIds && residencyIds.length > 0) {
      // Center-based scoping: get all BVSLs under all guides in these residencies
      const allGuideIds = await getGuideIdsForResidencies(residencyIds);
      if (allGuideIds.length > 0) {
        const bvslMap = new Map<string, any>();
        const fetches = await Promise.all(allGuideIds.map(gid =>
          readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active', guide: gid }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin'], limit: 200 })
        ));
        for (const res of fetches) for (const u of res.records) bvslMap.set(u.id, u);
        // Also get BVSLs from the residencies directly (in case they're not assigned to a specific guide)
        const resFetches = await Promise.all(residencyIds.map((rid: string) =>
          readScopedUsers(context.user, { filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin'], limit: 200 })
        ));
        for (const res of resFetches) for (const u of res.records) bvslMap.set(u.id, u);
        bvslUsers = Array.from(bvslMap.values());
      }
    } else {
      const userFilter: any = { isBvsl: true, status: 'Active' };
      if (guideDbId) userFilter.guide = guideDbId;

      const { records } = await readScopedUsers(context.user, {
        filters: userFilter,
        fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone', 'role', 'isBvAdmin', 'isBvSuperAdmin'],
        limit: 200,
      });
      bvslUsers = records.filter(u => u.id !== context.user!.id && u.userId !== context.user!.id);
    }

    const hierarchy = isPwDepartmentAdmin(context.user) ? null : await getScopedHierarchyUserIds(context.user);
    bvslUsers = bvslUsers.filter(user => isUserInHierarchy(user, hierarchy));
    const isFolkReport = (context.user as any).segment === 'FOLK' || (residencyIds && residencyIds.length > 0);
    if (isFolkReport) {
      bvslUsers = bvslUsers.filter(isFolkMemberLevelFacilitator);
    }

    if (bvslUsers.length === 0) {
      return { subjectType: isMemberMode ? 'members' : 'facilitators', bvsls: [], groups: [] };
    }

    const bvslDbIds = bvslUsers.map(u => u.id);

    // Get groups led by these BVSLs (with optional groupId filter). Supervisor
    // mode already resolved mixed Firestore/public/email ownership aliases.
    let groups: any[];
    if (hierarchyGroups !== null) {
      groups = hierarchyGroups;
    } else {
      const groupFilter: any = { bvslLeader: { in: bvslDbIds }, isActive: true };
      if (groupId) groupFilter.id = groupId;
      groups = (await BvGroups.findAll({
        filters: groupFilter,
        fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
        limit: 200,
      })).records;
    }

    // If a specific group is selected, only show BVSLs leading that group
    let filteredBvslUsers = bvslUsers;
    if (groupId && groups.length > 0 && !isMemberMode) {
      const leaderIdsInGroup = new Set(groups.flatMap(g => [
        g.bvslLeader, g.bvslId, g.subFacilitatorId, g.rgsfId, g.subFacilitator,
      ]).flat().filter(Boolean).map(value => String(value).toLowerCase()));
      filteredBvslUsers = bvslUsers.filter(u =>
        bvUserAliases(u).some(alias => leaderIdsInGroup.has(alias))
      );
    }

    const groupByBvsl = new Map<string, string>();
    const groupNameById = new Map<string, string>();
    for (const g of groups) {
      [g.id, g.groupId]
        .filter(Boolean)
        .forEach(value => groupNameById.set(String(value).toLowerCase(), g.groupName || ''));
      [g.bvslLeader, g.bvslId, g.subFacilitatorId, g.rgsfId, g.subFacilitator]
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .forEach(value => groupByBvsl.set(String(value).toLowerCase(), g.groupName || ''));
    }

    // Fetch preaching entries in date range
    const dateFilter = reportType === 'daily' || effectiveStart === effectiveEnd
      ? { entryDate: effectiveStart }
      : { entryDate: { gte: effectiveStart, lte: effectiveEnd } };

    const source = isMemberMode ? SadhanaEntries : BvslPreachingEntries;
    const ownerKeys = collectOwnerKeys(filteredBvslUsers, [
      'id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
      'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
      'fullName', 'displayName', 'name',
    ]);
    const loadedEntries = await readEntriesForOwners(
      query => source.findAll(query),
      ownerKeys,
      dateFilter as Record<string, unknown>,
      isMemberMode
        ? ['id', 'user', 'entryDate', 'preachingMinutes', 'booksDistributed', 'fieldValuesJson', 'submittedAt']
        : undefined,
    );
    const allEntries = isMemberMode ? loadedEntries.map(normaliseMemberBvActivity) : loadedEntries;

    const canonicalByAlias = new Map<string, string>();
    filteredBvslUsers.forEach(user => {
      bvUserAliases(user).forEach((alias: string) => canonicalByAlias.set(alias, user.id));
    });

    scopeRealtimeDependencies(isMemberMode ? 'SadhanaEntries' : 'BvslPreachingEntries', { kind: 'references', fields: ['user'], values: [...canonicalByAlias.keys()] });

    // Group entries by user
    const entriesByUser = new Map<string, any[]>();
    for (const e of allEntries) {
      const entryAliases = (Array.isArray(e.user) ? e.user : [e.user])
        .filter(Boolean).map((value: unknown) => String(value).toLowerCase());
      const canonicalId = entryAliases.map((alias: string) => canonicalByAlias.get(alias)).find(Boolean);
      if (!canonicalId) continue;
      if (!entriesByUser.has(canonicalId)) entriesByUser.set(canonicalId, []);
      entriesByUser.get(canonicalId)!.push(e);
    }

    const bvslRows = filteredBvslUsers.map(u => {
      const entries = entriesByUser.get(u.id) || [];
      const submitted = entries.length > 0;

      const sum = (field: string) => entries.reduce((s, e) => s + (Number((e as any)[field]) || 0), 0);

      const callingTime    = reportType === 'daily' ? (entries[0]?.prCallingTime ?? 0)      : sum('prCallingTime');
      const oneOnOneTime   = reportType === 'daily' ? (entries[0]?.prOneOnOneTime ?? 0)     : sum('prOneOnOneTime');
      const bookDistTime   = reportType === 'daily' ? (entries[0]?.prBookDistTime ?? 0)     : sum('prBookDistTime');
      const rduaTime       = reportType === 'daily' ? (entries[0]?.prRduaTime ?? 0)         : sum('prRduaTime');
      const planTime       = reportType === 'daily' ? (entries[0]?.prPlanTime ?? 0)         : sum('prPlanTime');
      const booksDistributed  = reportType === 'daily' ? (entries[0]?.prBooksDistributed ?? 0)  : sum('prBooksDistributed');
      const contactsCollected = reportType === 'daily' ? (entries[0]?.prContactsCollected ?? 0) : sum('prContactsCollected');
      const uniqueOneOnOnes   = reportType === 'daily' ? (entries[0]?.prUniqueOneOnOnes ?? 0)   : sum('prUniqueOneOnOnes');
      const totalMinutes      = reportType === 'daily' ? (entries[0]?.totalPreachingMinutes ?? 0) : sum('totalPreachingMinutes');

      return {
        id: u.id,
        userId: u.userId || u.id,
        fullName: u.fullName || '',
        phone: (u as any).phone || '',
        role: (u as any).role || '',
        isRgsf: !!(u as any).isBvSubFacilitator || String((u as any).role || '').toUpperCase().replace(/[\s-]+/g, '_') === 'RGSF',
        groupName: ((u as any).__bvScopedGroupIds || [])
          .map((id: unknown) => groupNameById.get(String(id).toLowerCase()))
          .find(Boolean) || bvUserAliases(u).map(alias => groupByBvsl.get(alias)).find(Boolean) || '—',
        submitted,
        callingTime: Number(callingTime) || 0,
        oneOnOneTime: Number(oneOnOneTime) || 0,
        bookDistTime: Number(bookDistTime) || 0,
        rduaTime: Number(rduaTime) || 0,
        planTime: Number(planTime) || 0,
        booksDistributed: Number(booksDistributed) || 0,
        contactsCollected: Number(contactsCollected) || 0,
        uniqueOneOnOnes: Number(uniqueOneOnOnes) || 0,
        totalMinutes: Number(totalMinutes) || 0,
        entriesCount: entries.length,
        submittedAt: entries.length > 0 ? (entries[0].submittedAt || null) : null,
      };
    });

    // Sort by totalMinutes desc
    bvslRows.sort((a, b) => b.totalMinutes - a.totalMinutes);

    return {
      subjectType: isMemberMode ? 'members' : 'facilitators',
      bvsls: bvslRows,
      groups: groups.map(g => ({ id: g.id, name: g.groupName || '' })),
    };
}
