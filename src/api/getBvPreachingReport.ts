import { z } from 'zod';
import { createEndpoint, Users, BvslPreachingEntries, BvGroups, Guides } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideIdsForResidencies } from '../lib/guideScope';

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
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isBvMentor = !!(context.user as any).isBvMentor;
    if (!input.bvslMode && !isBvMentor) requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor });

    const { guideId: inputGuideId, date, reportType, startDate, endDate, bvslMode, groupId, residencyIds } = input;
    const effectiveStart = (startDate || date || '').split('T')[0];
    const effectiveEnd = (endDate || date || '').split('T')[0];
    if (!effectiveStart) throw new Error('Invalid date');

    let guideDbId: string | null = inputGuideId === 'ALL' ? null : inputGuideId;

    // Robust guide ID resolution: resolve Users-table UUID → Guides-table UUID
    if (guideDbId) {
      const directGuideRec = await Guides.findOne({ id: guideDbId, fields: ['id'] }).catch(() => undefined);
      if (!directGuideRec) {
        const guideUser = await Users.findOne({ id: guideDbId, fields: ['id', 'email'] }).catch(() => undefined);
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

    let bvslUsers: any[] = [];
    if (bvslMode) {
      // bvslMode: return only the current user's data
      const me = await Users.findOne({
        id: context.user.id,
        fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone'],
      });
      if (me) bvslUsers = [me];
    } else if (residencyIds && residencyIds.length > 0) {
      // Center-based scoping: get all BVSLs under all guides in these residencies
      const allGuideIds = await getGuideIdsForResidencies(residencyIds);
      if (allGuideIds.length > 0) {
        const bvslMap = new Map<string, any>();
        const fetches = await Promise.all(allGuideIds.map(gid =>
          Users.findAll({ filters: { isBvsl: true, status: 'Active', guide: gid }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone'], limit: 200 })
        ));
        for (const res of fetches) for (const u of res.records) bvslMap.set(u.id, u);
        // Also get BVSLs from the residencies directly (in case they're not assigned to a specific guide)
        const resFetches = await Promise.all(residencyIds.map(rid =>
          Users.findAll({ filters: { isBvsl: true, status: 'Active', residency: rid }, fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone'], limit: 200 })
        ));
        for (const res of resFetches) for (const u of res.records) bvslMap.set(u.id, u);
        bvslUsers = Array.from(bvslMap.values());
      }
    } else {
      const userFilter: any = { isBvsl: true, status: 'Active' };
      if (guideDbId) userFilter.guide = guideDbId;

      const { records } = await Users.findAll({
        filters: userFilter,
        fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'phone'],
        limit: 200,
      });
      bvslUsers = records;
    }

    if (bvslUsers.length === 0) return { bvsls: [], groups: [] };

    const bvslDbIds = bvslUsers.map(u => u.id);

    // Get groups led by these BVSLs (with optional groupId filter)
    const groupFilter: any = { bvslLeader: { in: bvslDbIds }, isActive: true };
    if (groupId) groupFilter.id = groupId;

    const { records: groups } = await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupName', 'bvslLeader'],
      limit: 200,
    });

    // If a specific group is selected, only show BVSLs leading that group
    let filteredBvslUsers = bvslUsers;
    if (groupId && groups.length > 0) {
      const leaderIdsInGroup = new Set(
        groups.map(g => {
          const lid = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader;
          return lid as string;
        }).filter(Boolean)
      );
      filteredBvslUsers = bvslUsers.filter(u => leaderIdsInGroup.has(u.id));
    }

    const groupByBvsl = new Map<string, string>();
    for (const g of groups) {
      const lid = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader;
      if (lid) groupByBvsl.set(lid as string, g.groupName || '');
    }

    // Fetch preaching entries in date range
    const dateFilter = reportType === 'daily'
      ? { entryDate: effectiveStart }
      : { entryDate: { gte: effectiveStart, lte: effectiveEnd } };

    let allEntries: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await BvslPreachingEntries.findAll({
        filters: dateFilter as any,
        limit: 2000,
        offset,
      });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    const filteredBvslDbIds = filteredBvslUsers.map(u => u.id);

    // Group entries by user
    const entriesByUser = new Map<string, any[]>();
    for (const e of allEntries) {
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
      if (!uid || !filteredBvslDbIds.includes(uid)) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(e);
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
        groupName: groupByBvsl.get(u.id) || '—',
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
      bvsls: bvslRows,
      groups: groups.map(g => ({ id: g.id, name: g.groupName || '' })),
    };
  },
});
