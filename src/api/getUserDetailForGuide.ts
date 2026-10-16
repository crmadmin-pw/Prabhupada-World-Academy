import { z } from 'zod';
import { callerDirectoryDepartment, getScopedHierarchyUserIds, isPwDepartmentAdmin, isUserInHierarchy, memberDirectoryDepartment } from '../lib/hierarchyUtils';
import { createEndpoint, Users, Guides, SadhanaEntries, BvGroupMembers, BvGroups, FolkResidencies, AppError } from '@/lib/backend-sdk';
import { computeStreak, getTodayIST } from '../lib/streakUtils';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { isBvGroupProfileAdministrator } from '../lib/bvGroupMemberProfileNavigation';
import { groupHasFacilitator } from '../lib/bvGroupFacilitators';
import { bvUserAliases, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { isPwSadhanaUser } from '@/lib/sadhanaDepartment';
import { pwScoreFromFieldValues } from '@/lib/pwSadhana';

const LINK_FIELDS = ['id', 'userId', 'email', 'phone', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const USER_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'phone', 'email', 'ashrayLevel', 'status', 'bvGroupId', 'bvGroupName',
  'residency', 'residencyApproved', 'residencyGuideVerified', 'selectedFolkResidency',
  'temporaryResidency', 'temporaryResidencyEnabled', 'createdAt', 'lastLoginAt', 'isBvsl', 'isSadhanaMentor',
  'currentStreak', 'lastStreakUpdatedAt', 'guide', 'sadhanaMentor', 'segment', 'isPrabhupadaWorldUser',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
const ENTRY_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt', 'user', 'fieldValuesJson'];

/** Resolve a user record by DB UUID or custom userId field (e.g. "USER-031") */
async function resolveUser(id: string) {
  if (/^USER-\d+$/i.test(id)) {
    const { records } = await Users.findAll({ filters: { userId: id }, fields: USER_FIELDS });
    const registered = records.find(r => r.id !== r.userId);
    if (registered) return registered;
    if (records.length > 0) return records[0];
  }
  const byId = await Users.findOne({ id, fields: USER_FIELDS });
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
  if (records[0]) return records[0];
  // The roster can address a member by email, phone, or an auth id. Those
  // are not stored in the userId field, so a document-id lookup misses them.
  for (const field of LINK_FIELDS) {
    if (field === 'id' || field === 'userId') continue;
    const matched = await Users.findAll({ filters: { [field]: id }, fields: USER_FIELDS, limit: 2 });
    if (matched.records?.[0]) return matched.records[0];
  }
  return null;
}

function flatText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(flatText);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function phoneForms(value: string): string[] {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return [];
  const forms = [digits, digits.slice(-10)];
  if (digits.length === 10) forms.push(`91${digits}`);
  if (digits.length === 12 && digits.startsWith('91')) forms.push(digits.slice(2));
  return [...new Set(forms)];
}

function linkAliases(user: any): string[] {
  const aliases = new Set<string>(bvUserAliases(user));
  for (const field of LINK_FIELDS) {
    for (const value of flatText(user?.[field])) {
      const text = value.toLowerCase();
      aliases.add(text);
      phoneForms(text).forEach(form => aliases.add(form));
    }
  }
  return [...aliases];
}

async function identityAliases(user: any): Promise<{ aliases: Set<string>; groupPointers: string[] }> {
  const aliases = new Set(linkAliases(user));
  const groupPointers = flatText([user?.bvGroupId, user?.bvGroupName]);
  const seeds = [...new Set(LINK_FIELDS.flatMap(field => flatText(user?.[field])))].slice(0, 30);
  if (seeds.length === 0) return { aliases, groupPointers };
  const fields = [...new Set([...USER_FIELDS, ...LINK_FIELDS, 'bvGroupId', 'bvGroupName'])];
  for (const field of LINK_FIELDS) {
    const { records } = await Users.findAll({
      filters: { [field]: { in: seeds } } as any,
      fields,
      limit: 20,
    });
    for (const record of records || []) {
      linkAliases(record).forEach(alias => aliases.add(alias));
      groupPointers.push(...flatText([record?.bvGroupId, record?.bvGroupName]));
    }
  }
  return { aliases, groupPointers };
}

function aliasesHit(membership: any, aliases: Set<string>): boolean {
  return membershipAliases(membership).some(alias => aliases.has(alias) || phoneForms(alias).some(form => aliases.has(form)));
}

/** The group roster already lists this person. Profile lookup has to accept
 * the same row, including one stored by phone or by an older auth id. */
async function isOnCallerGroupRoster(caller: any, target: any): Promise<boolean> {
  const groups = await resolveBvScopedGroups(caller);
  if (groups.length === 0) return false;
  const identity = await identityAliases(target);
  const groupRefs = new Set(groups.flatMap(group =>
    [group.id, group.groupId, group.groupName, group.record?.groupName]
      .filter(Boolean)
      .map(value => String(value).trim().toLowerCase()),
  ));
  if (identity.groupPointers.some(value => groupRefs.has(value.trim().toLowerCase()))) return true;

  const groupIds = [...new Set(groups.flatMap(group => [group.id, group.groupId].filter(Boolean).map(String)))];
  const membershipFields = ['id', 'isActive', 'status', 'user', 'userId', 'memberId', 'group', 'groupId'];
  for (let start = 0; start < groupIds.length; start += 30) {
    const chunk = groupIds.slice(start, start + 30);
    const results = await Promise.all([
      BvGroupMembers.findAll({ filters: { group: { in: chunk } } as any, fields: membershipFields, limit: 500 }),
      BvGroupMembers.findAll({ filters: { groupId: { in: chunk } } as any, fields: membershipFields, limit: 500 }),
    ]);
    const matched = results.flatMap(result => result.records || [])
      .some(membership => membershipIsActive(membership) && aliasesHit(membership, identity.aliases));
    if (matched) return true;
  }
  return false;
}

/**
 * Check if a BVSL (identified by their DB record ID) has the target user
 * in any of their active BV groups.
 */
function membershipIsActive(membership: any): boolean {
  if (membership?.isActive === false) return false;
  const status = String(membership?.status || '').toLowerCase();
  return !['inactive', 'removed', 'left'].includes(status);
}

function membershipAliases(membership: any): string[] {
  return [membership?.user, membership?.userId, membership?.memberId]
    .flatMap(value => Array.isArray(value) ? value : [value])
    .flatMap(value => String(value ?? '').split(','))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

async function isBvslMember(caller: any, target: any, rgsfOnly = false): Promise<boolean> {
  const callerAliasSet = new Set(bvUserAliases(caller));

  const { records: bvslGroups } = await BvGroups.findAll({
    fields: ['id', 'groupId', 'isActive', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
    limit: 500,
  });

  const parentRgfKeys = new Set<string>();
  if (rgsfOnly) {
    const callerRecord = await Users.findOne({ id: caller?.id, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }) ||
      await Users.findOne({ filters: { userId: caller?.userId || caller?.id }, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] }) ||
      await Users.findOne({ filters: { email: caller?.email }, fields: ['id', 'userId', 'email', 'bvReportingFacilitatorId'] });
    const parentRefValue = caller?.bvReportingFacilitatorId || (callerRecord as any)?.bvReportingFacilitatorId;
    const parentRef = parentRefValue ? String(parentRefValue).toLowerCase() : '';
    if (parentRef) {
      parentRgfKeys.add(parentRef);
      const parent = await Users.findOne({ filters: { userId: parentRefValue }, fields: ['id', 'userId', 'email'] }) ||
        await Users.findOne({ id: parentRefValue, fields: ['id', 'userId', 'email'] }) ||
        await Users.findOne({ filters: { email: parentRefValue }, fields: ['id', 'userId', 'email'] });
      [parent?.id, parent?.userId, parent?.email].filter(Boolean).forEach(value => parentRgfKeys.add(String(value).toLowerCase()));
    }
  }

  const callerIsAlsoSubFacilitator = !!caller?.isBvSubFacilitator;
  const groups = bvslGroups.filter((group: any) => {
    if (group.isActive === false) return false;
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
    const callerOwnedLegacyGroup = facilitatorKeys.some((key) => callerAliasSet.has(key)) || groupHasFacilitator(group, callerAliasSet);
    const callerIsSubFacilitatorHere = subFacilitatorKeys.some((key) => callerAliasSet.has(key));
    // A PW user can be RGF of one group and RGSF of another. The members list
    // shows both, so the profile check has to accept both.
    if (rgsfOnly) return parentGroup || callerOwnedLegacyGroup || callerIsSubFacilitatorHere;
    return callerOwnedLegacyGroup || (callerIsAlsoSubFacilitator && callerIsSubFacilitatorHere);
  });

  const groupIds = [...new Set(groups.flatMap((g: any) => [g.id, g.groupId]).filter(Boolean).map((value: any) => String(value)))];
  if (groupIds.length === 0) return false;

  const targetAliases = new Set(linkAliases(target));
  if (targetAliases.size === 0) return false;

  const membershipFields = ['id', 'isActive', 'status', 'user', 'userId', 'memberId'];
  for (let start = 0; start < groupIds.length; start += 30) {
    const groupChunk = groupIds.slice(start, start + 30);
    const membershipResults = await Promise.all([
      BvGroupMembers.findAll({
        filters: { group: { in: groupChunk } } as any,
        fields: membershipFields,
        limit: 500,
      }),
      BvGroupMembers.findAll({
        filters: { groupId: { in: groupChunk } } as any,
        fields: membershipFields,
        limit: 500,
      }),
    ]);
    const matched = membershipResults
      .flatMap(result => result.records || [])
      .some(membership => membershipIsActive(membership) && aliasesHit(membership, targetAliases));
    if (matched) return true;
  }

  return false;
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
      isBvFacilitator: context.user.isBvFacilitator,
      isBvMentor: context.user.isBvMentor,
      isBvAdmin: context.user.isBvAdmin,
      isBvSuperAdmin: context.user.isBvSuperAdmin,
      isBvSupervisor: context.user.isBvSupervisor,
      isBvSubFacilitator: context.user.isBvSubFacilitator,
    });

    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });
    const callerRole = String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_');
    const isRgf = !!(context.user.isBvsl || context.user.isBvFacilitator) || ['RGF', 'BVSL', 'FACILITATOR'].includes(callerRole);
    const isRgsf = !!context.user.isBvSubFacilitator || callerRole === 'RGSF' || callerRole === 'SUB_FACILITATOR';
    // Admin-tier users manage members across their authorized department and
    // must not fall through to the RGF/guide-only scope checks below.
    const hasUnrestrictedProfileAccess = isBvGroupProfileAdministrator(context.user);
    const isBvMentor = !!(context.user.isBvMentor || context.user.isBvSupervisor);
    const isGuideRole = ['GUIDE', 'SUPER_GUIDE'].includes(callerRole);
    // The roster and this profile must agree. A member stored by phone, an
    // older auth id, or a duplicate profile is still the person on the list.
    const onRoster = await isOnCallerGroupRoster(context.user, userRecord);
    // A current group membership is enough. Reporting chains can lag behind
    // the member list the RGF just opened.
    const groupMember = onRoster || (
      !hasUnrestrictedProfileAccess && (isRgf || isRgsf)
        ? await isBvslMember(context.user, userRecord, isRgsf && !isRgf)
        : false
    );

    const callerDepartment = callerDirectoryDepartment(context.user);
    const targetDepartment = memberDirectoryDepartment(userRecord);
    if (!onRoster && !groupMember && callerDepartment && targetDepartment && callerDepartment !== targetDepartment) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This user belongs to another department' });
    }
    const inHierarchy = onRoster || isPwDepartmentAdmin(context.user) || isUserInHierarchy(userRecord, await getScopedHierarchyUserIds(context.user));
    if (!onRoster && !groupMember && !inHierarchy) {
      throw new AppError({
        code: 'FORBIDDEN',
        message: isRgsf && !isRgf
          ? 'You can only view members of your reporting RGF groups'
          : isRgf
            ? 'You can only view members of your BV groups'
            : 'This user is not assigned to your hierarchy',
      });
    }

    const facilitatorProfile = (isRgf || isRgsf) && !isGuideRole;
    if (!onRoster && !hasUnrestrictedProfileAccess && !isBvMentor && !groupMember && !facilitatorProfile) {
      // Try center-based scope (works for guides)
      const scope = await getGuideScope(context.user.email);

      if (isRgsf) {
        const allowed = await isBvslMember(context.user, userRecord, true);
        if (!allowed) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can only view members of your reporting RGF groups' });
        }
      } else if (scope) {
        // Caller has a guide record — enforce center-based access
        if (!isUserInGuideScope(scope, userRecord)) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can only view users in your center' });
        }
      } else if (isRgf || context.user.isBvsl) {
        // BVSL: check if the target user is in one of their BV groups
        const allowed = await isBvslMember(context.user, userRecord);
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
             });
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

    const isPwMember = isPwSadhanaUser(userRecord);
    const entryPercent = (entry: any) => isPwMember
      ? pwScoreFromFieldValues(entry.fieldValuesJson).scorePercent
      : (entry.scorePercent == null
          ? (Number(entry.maxScore) > 0 ? Math.min(100, Math.round((Number(entry.totalScore) / Number(entry.maxScore)) * 100)) : null)
          : Number(entry.scorePercent));
    const scores = sortedEntries.map(entryPercent).filter((score: number | null): score is number => score != null && score > 0);
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
        const guideRecord = await Guides.findOne({ id: guideId as string, fields: ['id', 'fullName'] });
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
        scorePercent: entryPercent(e),
        flagSick: !!(e.flagSick),
        flagOs: !!(e.flagOs),
        submittedAt: (e.submittedAt as string) || '',
      })),
      bvGroup,
    };
  },
});
