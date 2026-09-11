import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy } from '../lib/hierarchyUtils';
import { createEndpoint, Users, Guides, SadhanaEntries, BvGroupMembers, BvGroups, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { computeStreak, getTodayIST } from '../lib/streakUtils';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { isBvGroupProfileAdministrator } from '../lib/bvGroupMemberProfileNavigation';

const USER_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'phone', 'email', 'ashrayLevel', 'status',
  'residency', 'residencyApproved', 'residencyGuideVerified', 'selectedFolkResidency',
  'temporaryResidency', 'temporaryResidencyEnabled', 'createdAt', 'lastLoginAt', 'isBvsl', 'isSadhanaMentor',
  'currentStreak', 'lastStreakUpdatedAt', 'guide', 'sadhanaMentor', 'segment', 'isPrabhupadaWorldUser',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const ENTRY_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt', 'user'];

/** Resolve a user record by DB UUID or custom userId field (e.g. "USER-031") */
async function resolveUser(id: string) {
  if (/^USER-\d+$/i.test(id)) {
    const { records } = await Users.findAll({ filters: { userId: id }, fields: USER_FIELDS });
    const registered = records.find(r => r.id !== r.userId);
    if (registered) return registered;
    if (records.length > 0) return records[0];
  }
  const byId = await Users.findOne({ id, fields: USER_FIELDS }).catch(() => undefined);
  if (byId) {
    if (byId.id === byId.userId) {
      const { records } = await Users.findAll({ filters: { userId: byId.userId }, fields: USER_FIELDS });
      const registered = records.find(r => r.id !== r.userId);
      if (registered) return registered;
    }
    return byId;
  }
  const { records } = await Users.findAll({ filters: { userId: id }, fields: USER_FIELDS });
  const registered = records.find(r => r.id !== r.userId);
  if (registered) return registered;
  return records[0] || null;
}

/**
 * Check if a BVSL (identified by their DB record ID) has the target user
 * in any of their active BV groups.
 */
async function isBvslMember(caller: any, targetUserId: string, rgsfOnly = false): Promise<boolean> {
  const callerKeys = [
    caller?.id,
    caller?.userId,
    caller?.email,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  const { records: bvslGroups } = await BvGroups.findAll({
    filters: { isActive: true } as any,
    fields: ['id', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
    limit: 500,
  });

  const parentRgfKeys = new Set<string>();
  if (rgsfOnly) {
    const callerRecord = await Users.findOne({ id: caller?.id, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }).catch(() => undefined) ||
      await Users.findOne({ filters: { userId: caller?.userId || caller?.id }, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }).catch(() => undefined) ||
      await Users.findOne({ filters: { email: caller?.email }, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }).catch(() => undefined);
    const parentRefValue = caller?.bvReportingFacilitatorId || (callerRecord as any)?.bvReportingFacilitatorId;
    const parentRef = parentRefValue ? String(parentRefValue).toLowerCase() : '';
    if (parentRef) {
      parentRgfKeys.add(parentRef);
      const parent = await Users.findOne({ filters: { userId: parentRefValue }, fields: ['id', 'userId', 'email'] }).catch(() => undefined) ||
        await Users.findOne({ id: parentRefValue, fields: ['id', 'userId', 'email'] }).catch(() => undefined) ||
        await Users.findOne({ filters: { email: parentRefValue }, fields: ['id', 'userId', 'email'] }).catch(() => undefined);
      [parent?.id, parent?.userId, parent?.email].filter(Boolean).forEach(value => parentRgfKeys.add(String(value).toLowerCase()));
    }
  }

  const groups = bvslGroups.filter((group: any) => {
    const facilitatorKeys = [
      group.bvslLeader,
      group.bvslId,
    ].flatMap((value) => Array.isArray(value) ? value : [value])
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const subFacilitatorKeys = [
      group.subFacilitatorId,
      group.rgsfId,
      group.subFacilitator,
    ].flatMap((value) => Array.isArray(value) ? value : [value])
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    const parentGroup = facilitatorKeys.some((key) => parentRgfKeys.has(key));
    const callerOwnedLegacyGroup = facilitatorKeys.some((key) => callerKeys.includes(key));
    return rgsfOnly
      ? parentGroup || callerOwnedLegacyGroup || subFacilitatorKeys.some((key) => callerKeys.includes(key))
      : callerOwnedLegacyGroup;
  });

  const groupIds = groups.map((g: any) => g.id).filter(Boolean);
  if (groupIds.length === 0) return false;

  const targetKeys = [targetUserId].filter(Boolean).map((value) => String(value));
  const targetUser = await Users.findOne({ id: targetUserId, fields: ['id', 'userId', 'email'] }).catch(() => undefined);
  if (targetUser?.userId) targetKeys.push(String(targetUser.userId));
  if (targetUser?.email) targetKeys.push(String(targetUser.email));

  const membershipResults = await Promise.all(targetKeys.map((userKey) => BvGroupMembers.findAll({
    filters: { group: { in: groupIds }, user: userKey } as any,
    fields: ['id'],
    limit: 1,
  }).catch(() => ({ records: [] }))));

  return membershipResults.some((result) => result.records.length > 0);
}

export default createEndpoint({
  description: 'Get detailed user data for guide view — with center-based access control',
  authenticated: true,
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!input.userId) throw new AppError({ code: 'BAD_REQUEST', message: 'userId is required' });

    // Authorization: only guides, super guides, BVSLs, sadhana mentors, or BV Mentors can view user details
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: context.user.isBvMentor,
      isBvAdmin: context.user.isBvAdmin,
      isBvSuperAdmin: context.user.isBvSuperAdmin,
      isBvSupervisor: context.user.isBvSupervisor,
      isBvSubFacilitator: context.user.isBvSubFacilitator,
    });

    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });
    if (!isUserInHierarchy(userRecord, await getScopedHierarchyUserIds(context.user))) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This user is not assigned to your hierarchy' });
    }

    // Admin-tier users manage members across their authorized department and
    // must not fall through to the RGF/guide-only scope checks below.
    const hasUnrestrictedProfileAccess = isBvGroupProfileAdministrator(context.user);

    const isBvMentor = !!(context.user.isBvMentor || context.user.isBvSupervisor);
    const isRgsf = !!context.user.isBvSubFacilitator ||
      String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_').includes('RGSF');

    if (!hasUnrestrictedProfileAccess && !isBvMentor) {
      // Try center-based scope (works for guides)
      const scope = await getGuideScope(context.user.email);

      if (isRgsf) {
        const allowed = await isBvslMember(context.user, userRecord.id, true);
        if (!allowed) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can only view members of your reporting RGF groups' });
        }
      } else if (scope) {
        // Caller has a guide record — enforce center-based access
        if (!isUserInGuideScope(scope, userRecord)) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can only view users in your center' });
        }
      } else if (context.user.isBvsl) {
        // BVSL: check if the target user is in one of their BV groups
        const allowed = await isBvslMember(context.user, userRecord.id);
        if (!allowed) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can only view members of your BV groups' });
        }
      } else if (context.user.isSadhanaMentor) {
        const isPwMentor = context.user.segment === 'PW' || !!(context.user as any).isPrabhupadaWorldUser;
        if (isPwMentor) {
          const uSadhanaMentor = String(userRecord.sadhanaMentor || '').toLowerCase();
          const mentorId = String(context.user.id || '').toLowerCase();
          const mentorUid = String(context.user.userId || '').toLowerCase();
          const allowed = uSadhanaMentor === mentorId || uSadhanaMentor === mentorUid;
          if (!allowed) {
            throw new AppError({ code: 'FORBIDDEN', message: 'You can only view members assigned to you' });
          }
        } else {
          // FOLK Sadhana Mentor: check if they are under the same guide/admin
          const mentorUser = await Users.findOne({ id: context.user.id, fields: ['guide'] });
          const mentorGuideId = Array.isArray(mentorUser?.guide) ? mentorUser.guide[0] : mentorUser?.guide;
          const userGuideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
          const allowed = mentorGuideId && userGuideId && mentorGuideId === userGuideId;
          if (!allowed) {
            throw new AppError({ code: 'FORBIDDEN', message: 'You can only view members under your guide' });
          }
        }
      } else {
        throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
      }
    }

    const residencyId = Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency;
    const effectiveResidencyId = residencyId || (Array.isArray(userRecord.selectedFolkResidency) ? userRecord.selectedFolkResidency[0] : userRecord.selectedFolkResidency);

    // Fetch the complete Sadhana history for the profile. Guide profiles and
    // the calendar are historical views; limiting this to the recent 100 days
    // silently hid older migrated records and made old-month colors disappear.
    const todayStr = getTodayIST();

    const entryOwnerIds = [...new Set([
      userRecord.id,
      userRecord.userId,
      userRecord.email,
      userRecord.uid,
      userRecord.authUid,
      userRecord.firebaseUid,
      userRecord.firebaseUserId,
      userRecord.firebaseAuthUid,
      userRecord.authId,
      userRecord.authUserId,
      userRecord.firebaseId,
      userRecord.firebaseAuthId,
      userRecord.firebase_id,
    ].filter(Boolean).map((value: any) => String(value).trim()))];
     const [allEntriesRes, membershipResults, residencyRecord] = await Promise.all([
       (async () => {
         const records: any[] = [];
         // Query by every known owner alias so a migrated profile gets its
         // complete history without scanning every user's entries.
         for (let start = 0; start < entryOwnerIds.length; start += 30) {
           const ownerChunk = entryOwnerIds.slice(start, start + 30);
           let offset = 0;
           while (true) {
             const page = await SadhanaEntries.findAll({
               filters: { user: { in: ownerChunk }, entryDate: { gte: '1900-01-01', lte: todayStr } } as any,
               fields: ENTRY_FIELDS,
               limit: 2000,
               offset,
             }).catch(() => ({ records: [], hasMore: false }));
             records.push(...(page.records || []));
             if (!page.hasMore || (page.records || []).length === 0 || records.length >= 100000) break;
             offset += (page.records || []).length;
           }
         }
         return { records };
       })(),
       Promise.all(entryOwnerIds.map(ownerId => BvGroupMembers.findAll({
         filters: { user: ownerId }, fields: ['id', 'group'], limit: 3,
       }))),
       effectiveResidencyId
         ? FolkResidencies.findOne({ id: effectiveResidencyId as string, fields: ['id', 'residencyName'] })
         : Promise.resolve(null),
     ]);
 
     const entryOwnerSet = new Set(entryOwnerIds.map(id => String(id).trim().toLowerCase()));
     const entryById = new Map<string, any>();
     (allEntriesRes.records || []).forEach((entry: any) => {
       const owner = String(Array.isArray(entry.user) ? entry.user[0] : entry.user || '').trim().toLowerCase();
       if (entryOwnerSet.has(owner)) {
         entryById.set(String(entry.id), entry);
       }
     });
    const membershipById = new Map<string, any>();
    membershipResults.flatMap(result => result.records).forEach((membership: any) => membershipById.set(String(membership.id), membership));
    const memberships = [...membershipById.values()];
    const sortedEntries = [...entryById.values()].sort((a: any, b: any) =>
      ((b.entryDate as string) || '').localeCompare((a.entryDate as string) || '')
    );

    const scores = sortedEntries.map((e: any) => Math.min(100, e.scorePercent ?? 0)).filter((s: number) => s > 0);
    const avgScorePercent = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

    const streak = computeStreak(sortedEntries as any[], todayStr);

    let bvGroup: { groupId: string; groupName: string } | null = null;
    if (memberships.length > 0) {
      const gId = Array.isArray(memberships[0].group)
        ? memberships[0].group[0]
        : memberships[0].group;
      if (gId) {
        const g = await BvGroups.findOne({ id: gId as string, fields: ['id', 'groupId', 'groupName'] });
        if (g) bvGroup = { groupId: (g.groupId as string) || g.id, groupName: (g.groupName as string) || '' };
      }
    }

    // Also fetch guide name
    const guideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
    let guideName: string | null = null;
    if (guideId) {
      const { records: guides } = await Users.findAll({
        filters: { id: guideId } as any,
        fields: ['id', 'fullName'],
        limit: 1,
      });
      guideName = guides[0]?.fullName as string || null;
      if (!guideName) {
        const guideRecord = await Guides.findOne({ id: guideId as string, fields: ['id', 'fullName'] }).catch(() => undefined);
        guideName = guideRecord?.fullName as string || null;
      }
    }

    return {
      user: {
        userId: (userRecord.userId as string) || userRecord.id,
        dbId: userRecord.id,
        segment: userRecord.segment,
        isPrabhupadaWorldUser: userRecord.isPrabhupadaWorldUser,
        fullName: (userRecord.fullName as string) || (userRecord.displayName as string) || (userRecord.name as string) || (userRecord.userId as string) || userRecord.id,
        phone: userRecord.phone || '',
        email: (userRecord.email as string) || '',
        ashrayLevel: (userRecord.ashrayLevel as string) || null,
        status: (userRecord.status as string) || 'Active',
        residencyName: (residencyRecord as any)?.residencyName || null,
        isResident: !!((userRecord.residencyApproved || userRecord.residencyGuideVerified) && (residencyId || userRecord.selectedFolkResidency)),
        createdAt: (userRecord.createdAt as string) || '',
        lastLoginAt: (userRecord.lastLoginAt as string) || null,
        isBvsl: !!(userRecord.isBvsl),
        isSadhanaMentor: !!(userRecord.isSadhanaMentor),
        guideName,
      },
      metrics: {
        currentStreak: streak,
        totalEntries: sortedEntries.length,
        avgScorePercent,
        weeklyAvgScore: 0,
      },
      recentEntries: sortedEntries.map((e: any) => ({
        entryId: (e.entryId as string) || e.id,
        rowId: e.id,
        entryDate: (e.entryDate as string) || '',
        totalScore: (e.totalScore as number) ?? 0,
        maxScore: (e.maxScore as number) ?? 0,
        scorePercent: e.scorePercent == null
          ? (Number(e.maxScore) > 0 ? Math.min(100, Math.round((Number(e.totalScore) / Number(e.maxScore)) * 100)) : null)
          : Number(e.scorePercent),
        flagSick: !!(e.flagSick),
        flagOs: !!(e.flagOs),
        submittedAt: (e.submittedAt as string) || '',
      })),
      bvGroup,
    };
  },
});
