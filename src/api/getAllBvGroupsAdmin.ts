import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, Guides } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch, serverCacheInvalidate } from '../lib/serverCache';
import { isBvDepartmentAdmin, isBvSuperAdminUser, resolveBvDepartmentGroups } from '../lib/bvGroupMemberScope';
import { callerDirectoryDepartment, getScopedHierarchyUserIds, isUserInHierarchy, hierarchyRefs, readScopedUsers } from '../lib/hierarchyUtils';
import { joinFacilitatorNames, readGroupFacilitators, textList } from '@/lib/bvGroupFacilitators';

export function facilitatorIdentityRefs(group: { bvslLeader?: unknown; bvslId?: unknown; bvslName?: unknown }): string[] {
  return [...new Set([...groupFacilitatorRefs(group), ...textList(group.bvslName)])];
}

export function supervisorIdentityRefs(group: { supervisorId?: unknown; supervisorUserId?: unknown }): string[] {
  return [...new Set(
    [group.supervisorId, group.supervisorUserId]
      .flatMap(value => textList(value))
      .map(value => value.trim())
      .filter(Boolean),
  )];
}

export function rgsfIdentityRefs(group: { subFacilitatorId?: unknown; rgsfId?: unknown; subFacilitator?: unknown }): string[] {
  return [...new Set(
    [group.subFacilitatorId, group.rgsfId, group.subFacilitator]
      .flatMap(value => textList(value))
      .map(value => value.trim())
      .filter(Boolean),
  )];
}

export function groupFacilitatorRefs(group: { bvslLeader?: unknown; bvslId?: unknown }): string[] {
  return [group.bvslLeader, group.bvslId]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function aliasKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function indexFacilitatorUsers(users: readonly any[], into = new Map<string, any>()) {
  for (const user of users) {
    for (const ref of [user?.id, user?.userId, user?.email]) {
      const key = aliasKey(ref);
      if (key && !into.has(key)) into.set(key, user);
    }
  }
  return into;
}

/** The reading-group RGF may be stored as a document id, public user id, or email. */
export function facilitatorDisplayName(group: { bvslLeader?: unknown; bvslId?: unknown; bvslName?: unknown }, usersByAlias: Map<string, any>): string | null {
  const resolved = readGroupFacilitators(group).map(item => {
    const user = [item.id, item.userId]
      .map(ref => usersByAlias.get(aliasKey(ref)))
      .find(Boolean);
    return String(user?.fullName || item.name || '').trim();
  });
  const joined = joinFacilitatorNames(resolved);
  return joined || null;
}

export default createEndpoint({
  description: 'Get all BV groups and BVSLs under a guide (admin view — for Guide/Super Guide)',
  authenticated: true,
  requiredCapabilities: 'bv.manage',
  inputSchema: z.object({
    guideId: z.string(),
    // Members directory: a department admin assigns any group in the department,
    // including groups that report to another admin.
    departmentWide: z.boolean().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.object({
    bvsls: z.array(z.object({
      userId: z.string(),
      fullName: z.string(),
      email: z.string().optional(),
      groupCount: z.number(),
      totalMembers: z.number(),
    })),
    groups: z.array(z.object({
      groupId: z.string(),
      groupDbId: z.string().optional(),
      groupName: z.string(),
      description: z.string(),
      isActive: z.boolean(),
      memberCount: z.number(),
      sessionCount: z.number(),
      totalSessions: z.number(),
      avgAttendanceRate: z.number(),
      joinToken: z.string().nullable(),
      bvslLeaderId: z.string().nullable(),
      facilitatorIds: z.array(z.string()).optional(),
      rgfIds: z.array(z.string()).optional(),
      rgsfIds: z.array(z.string()).optional(),
      supervisorIds: z.array(z.string()).optional(),
      bvslLeaderName: z.string().nullable(),
      bvslName: z.string().nullable(),
      meetingTime: z.string().nullable(),
    })),
    error: z.string().nullable(),
  }),
  execute: async ({ input, context }: { input: { guideId: string; departmentWide?: boolean; segment?: 'PW' | 'FOLK' }; context: any }) => {
    if (input.departmentWide && isBvDepartmentAdmin(context?.user)) {
      const ownDepartment = callerDirectoryDepartment(context.user);
      const segment = isBvSuperAdminUser(context.user)
        ? (input.segment || ownDepartment || 'PW')
        : (ownDepartment || input.segment);
      if (segment === 'PW' || segment === 'FOLK') {
        const directory = await resolveBvDepartmentGroups(segment, undefined, { includeInactive: true });
        return {
          bvsls: [],
          groups: directory.map(group => {
            const facilitatorIds = facilitatorIdentityRefs(group.record);
            return {
              groupId: group.groupId,
              groupDbId: group.id,
              groupName: group.groupName,
              description: String(group.record.description || ''),
              isActive: group.record.isActive !== false,
              memberCount: 0,
              sessionCount: 0,
              totalSessions: 0,
              avgAttendanceRate: 0,
              joinToken: null,
              bvslLeaderId: facilitatorIds[0] || null,
              facilitatorIds,
              rgfIds: facilitatorIds,
              rgsfIds: rgsfIdentityRefs(group.record),
              supervisorIds: supervisorIdentityRefs(group.record),
              bvslLeaderName: null,
              bvslName: null,
              meetingTime: null,
            };
          }),
          error: null,
        };
      }
    }
    // A normal admin is always scoped to their own hierarchy, even if a
    // different guide ID is supplied by a modified client. Super admins may
    // intentionally select another guide or department-wide view.
    const effectiveGuideId = isBvSuperAdminUser(context?.user)
      ? input.guideId
      : String(context?.user?.id || '');
    if (!effectiveGuideId) return { bvsls: [], groups: [], error: null };
    // Short cache keyed by the server-resolved scope. Table writes invalidate
    // local entries; the TTL bounds freshness across other server instances.
    const cacheKey = `allBvGroupsAdmin:${effectiveGuideId}`;
    // Resolve authorization before any cached result: a recent reassignment
    // must not leave a former admin able to read a group's cached members.
    const hierarchy = await getScopedHierarchyUserIds(context.user);
    if (hierarchy !== null) return _fetchAllBvGroupsAdmin(effectiveGuideId, hierarchy, context.user);
    return serverCacheGetOrFetch(cacheKey, () => _fetchAllBvGroupsAdmin(effectiveGuideId, null, context.user), 30_000);
  },
});

export { serverCacheInvalidate as _invalidateAllBvGroupsAdmin };

async function _fetchAllBvGroupsAdmin(inputGuideId: string, hierarchy: Set<string> | null, caller: any) {

    // Resolve legacy identity forms in one batch and reuse the records. Keep
    // the same precedence: Guides document, linked user email, custom guide ID.
    const guideFields = ['id', 'fullName', 'email', 'guideId', 'folkResidencies'];
    const userFields = ['id', 'userId', 'fullName', 'email', 'folkResidencies', 'residency'];
    const [directGuide, userById, userByCustomId, guideByCustomId] = await Promise.all([
      Guides.findOne({ id: inputGuideId, fields: guideFields }),
      Users.findOne({ id: inputGuideId, fields: userFields }),
      Users.findOne({ filters: { userId: inputGuideId }, fields: userFields }),
      Guides.findOne({ filters: { guideId: inputGuideId }, fields: guideFields }),
    ]);
    let linkedGuideUser = directGuide ? undefined : (userById || userByCustomId);
    const guideByEmail = !directGuide && linkedGuideUser?.email
      ? await Guides.findOne({ filters: { email: linkedGuideUser.email }, fields: guideFields })
      : undefined;
    const resolvedGuide = directGuide || guideByEmail || guideByCustomId;
    const guideDbId: string | null = resolvedGuide?.id || null;
    if (!guideDbId && !linkedGuideUser) return { bvsls: [], groups: [], error: null };

    if (!linkedGuideUser && resolvedGuide?.email) {
      linkedGuideUser = await Users.findOne({ filters: { email: resolvedGuide.email }, fields: userFields });
    }
    linkedGuideUser = linkedGuideUser || userById || userByCustomId;
    const rawGuideResidencies = (resolvedGuide as any)?.folkResidencies ||
      (linkedGuideUser as any)?.folkResidencies ||
      (linkedGuideUser as any)?.residency || [];
    const guideResidencies = Array.isArray(rawGuideResidencies)
      ? rawGuideResidencies
      : [rawGuideResidencies];
    const guideResidencyAliases = new Set(
      guideResidencies
        .flatMap((value: any) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value: any) => String(value).trim().toLowerCase())
    );


    // Resolve active RGFs from the Users table, then match every legacy guide
    // representation (Guide ID, custom ID, name, or email).
    const guideAliases = new Set([
      guideDbId,
      (resolvedGuide as any)?.fullName,
      (resolvedGuide as any)?.email,
      (resolvedGuide as any)?.guideId,
      inputGuideId,
      (linkedGuideUser as any)?.id,
      (linkedGuideUser as any)?.userId,
    ].filter(Boolean).map(value => String(value).trim().toLowerCase()));
    const [{ records: allGroupRecords }, { records: allBvslUsers }] = await Promise.all([
      BvGroups.findAll({
        // Load every group, including deactivated ones, then match the guide
        // in memory. An isActive filter here removed them from both departments.
        limit: 1000,
      }),
      readScopedUsers(caller, {
        // Keep this a single-field query; filtering both status and isBvsl can
        // require a composite index that may not exist immediately after deploy.
        filters: { status: 'Active' },
        limit: 1000,
        fields: ['id', 'userId', 'fullName', 'email', 'guide', 'selectedGuideId', 'guideName', 'residency', 'role', 'isBvsl', 'isBvFacilitator', 'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingAdminName', 'bvReportingSupervisorName'],
      }),
    ]);
    const bvslUserRecords = allBvslUsers.filter((u: any) => {
      if (u.isBvsl !== true && String(u.role || '').toUpperCase() !== 'BVSL' && u.isBvFacilitator !== true) return false;
      if (hierarchy !== null) return isUserInHierarchy(u, hierarchy);
      const guideValues = [
        u.guide, u.selectedGuideId, u.guideName,
        u.bvReportingAdminId, u.bvReportingSupervisorId,
        u.bvReportingAdminName, u.bvReportingSupervisorName,
      ].flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
      const residencyValues = [u.residency].flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean);
      const matchesGuide = guideValues.some(value => guideAliases.has(String(value).trim().toLowerCase()));
      const matchesResidency = residencyValues.some(value => guideResidencyAliases.has(String(value).trim().toLowerCase()));
      return matchesGuide || matchesResidency;
    });
    const rgfAliases = new Set(bvslUserRecords.flatMap((u: any) => [u.id, u.userId]).filter(Boolean).map((v: any) => String(v).toLowerCase()));
    const groupRecords = allGroupRecords.filter((g: any) => {
      if (hierarchy !== null) {
        const guideRefs = hierarchyRefs(g.guide);
        if (guideRefs.length && !guideRefs.some(ref => hierarchy.has(ref))) return false;
        return hierarchyRefs([g.guide, g.bvslLeader, g.bvslId, g.subFacilitatorId, g.rgsfId]).some(ref => hierarchy.has(ref));
      }
      const groupGuide = Array.isArray(g.guide) ? g.guide[0] : g.guide;
      const facilitatorRefs = textList(g.bvslLeader).concat(textList(g.bvslId));
      return guideAliases.has(String(groupGuide || '').toLowerCase()) ||
        facilitatorRefs.some(ref => rgfAliases.has(ref.toLowerCase()));
    });

    // ── Batch all member + attendance queries in 2 round-trips ──────────────
    // Previously this was 2 queries per group (N×2 = up to 40+ round-trips).
    // Now we fetch ALL members and ALL attendance across all matched groups in
    // one shot each, then group in memory — same data, far fewer round-trips.
    const allGroupIds = groupRecords.map((g: any) => g.id);

    const [allMembersRes, allAttRes] = await Promise.all([
      allGroupIds.length === 0 ? Promise.resolve({ records: [] }) : BvGroupMembers.findAll({
        filters: { group: { in: allGroupIds } } as any,
        fields: ['id', 'group'],
        limit: 5000,
      }),
      allGroupIds.length === 0 ? Promise.resolve({ records: [] }) : BvAttendance.findAll({
        filters: { group: { in: allGroupIds } } as any,
        fields: ['id', 'group', 'present', 'attendanceDate'],
        limit: 10000,
      }),
    ]);

    // Build per-group lookup maps from the batch results
    const memberCountByGroup = new Map<string, number>();
    for (const m of allMembersRes.records) {
      const gid = Array.isArray((m as any).group) ? (m as any).group[0] : (m as any).group;
      if (gid) memberCountByGroup.set(gid, (memberCountByGroup.get(gid) ?? 0) + 1);
    }
    const attByGroup = new Map<string, any[]>();
    for (const a of allAttRes.records) {
      const gid = Array.isArray((a as any).group) ? (a as any).group[0] : (a as any).group;
      if (gid) {
        if (!attByGroup.has(gid)) attByGroup.set(gid, []);
        attByGroup.get(gid)!.push(a);
      }
    }

    const usersByAlias = indexFacilitatorUsers(allBvslUsers);
    const listedFacilitators = new Map(bvslUserRecords.map((user: any) => [String(user.id), user]));
    const isCurrentFacilitator = (user: any) => {
      const role = String(user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
      return user?.isBvFacilitator === true || user?.isBvsl === true || ['RGF', 'BVSL', 'FACILITATOR'].includes(role);
    };
    const missingFacilitators = [...new Set(groupRecords.flatMap(groupFacilitatorRefs))]
      .filter(ref => !usersByAlias.has(aliasKey(ref)));
    if (missingFacilitators.length > 0) {
      const facilitatorFields = ['id', 'userId', 'fullName', 'email', 'role', 'isBvFacilitator', 'isBvsl'];
      for (let index = 0; index < missingFacilitators.length; index += 30) {
        const batch = missingFacilitators.slice(index, index + 30);
        const [byId, byUserId, byEmail] = await Promise.all([
          Users.findAll({ filters: { id: { in: batch } }, fields: facilitatorFields, limit: 30 }),
          Users.findAll({ filters: { userId: { in: batch } }, fields: facilitatorFields, limit: 30 }),
          Users.findAll({ filters: { email: { in: batch.map(ref => ref.toLowerCase()) } }, fields: facilitatorFields, limit: 30 }),
        ]);
        indexFacilitatorUsers([...(byId.records || []), ...(byUserId.records || []), ...(byEmail.records || [])], usersByAlias);
      }
    }

    const groups = groupRecords.map((g: any) => {
      const bvslDbId = textList(g.bvslLeader)[0] || textList(g.bvslId)[0];

      const memberCount = memberCountByGroup.get(g.id) ?? 0;
      const attRecords = attByGroup.get(g.id) ?? [];

      // Count distinct session dates
      const distinctDates = new Set(attRecords.map((a: any) => a.attendanceDate).filter(Boolean));
      const sessionCount = distinctDates.size;

      // Compute avg attendance rate
      const totalPresent = attRecords.filter((a: any) => a.present).length;
      const totalPossible = memberCount * sessionCount;
      const avgAttendanceRate = totalPossible > 0
        ? Math.round((totalPresent / totalPossible) * 100)
        : 0;

      const matchedUsers: any[] = [];
      const seenUsers = new Set<string>();
      for (const ref of groupFacilitatorRefs(g)) {
        const user = usersByAlias.get(aliasKey(ref));
        if (!user?.id || seenUsers.has(user.id)) continue;
        seenUsers.add(user.id);
        matchedUsers.push(user);
        if (isCurrentFacilitator(user)) listedFacilitators.set(String(user.id), user);
      }
      const bvslUser = matchedUsers[0];
      const bvslName = facilitatorDisplayName(g, usersByAlias);
      const facilitatorIds = [...new Set([
        ...facilitatorIdentityRefs(g),
        ...matchedUsers.flatMap(user => [user.id, user.userId, user.email, user.fullName]),
      ].map(value => String(value || '').trim()).filter(Boolean))];

      return {
        groupId: g.groupId || g.id,
        groupDbId: g.id,
        groupName: g.groupName || '',
        description: g.description || '',
        isActive: g.isActive ?? true,
        memberCount,
        sessionCount,
        totalSessions: sessionCount,
        avgAttendanceRate,
        joinToken: g.joinToken || null,
        bvslLeaderId: bvslUser?.userId || bvslDbId || facilitatorIds[0] || null,
        facilitatorIds,
        rgfIds: facilitatorIds,
        rgsfIds: rgsfIdentityRefs(g),
        supervisorIds: supervisorIdentityRefs(g),
        bvslLeaderName: bvslName,
        bvslName,
        meetingTime: g.meetingTime || g.preferredTimeSlot || null,
      };
    });

    const bvsls = [...listedFacilitators.values()].map(u => {
      const identity = new Set([u.userId, u.id, u.email, u.fullName]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean));
      const userGroups = groups.filter(g => [g.bvslLeaderId, ...(g.facilitatorIds || []), g.bvslLeaderName]
        .some(value => identity.has(String(value || '').trim().toLowerCase())));
      return {
        userId: u.id, // Always use DB UUID for consistent ID comparison
        fullName: u.fullName || '',
        email: u.email || '',
        groupCount: userGroups.length,
        totalMembers: userGroups.reduce((sum, g) => sum + g.memberCount, 0),
      };
    });

    return { bvsls, groups, error: null };
}
