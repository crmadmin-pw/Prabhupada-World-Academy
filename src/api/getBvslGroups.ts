import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, BvGroupRequests, Guides, Users, AppError } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { bvUserAliases, isBvSuperAdminUser, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { joinFacilitatorNames, readGroupFacilitators, textList } from '@/lib/bvGroupFacilitators';

function ownerKeys(group: any): string[] {
  return [group?.bvslLeader, group?.bvslId, group?.bvslName]
    .flatMap(value => textList(value))
    .map(value => value.toLowerCase());
}

const FIRESTORE_IN_LIMIT = 30;
const MEMBERSHIP_FIELDS = ['id', 'group', 'groupId', 'user', 'userId', 'memberId'];
const GUIDE_RECORD_FIELDS = ['id', 'guideId', 'fullName', 'email', 'segment'];
const USER_LOOKUP_FIELDS = [
  'userId', 'id', 'email', 'uid', 'authUid', 'firebaseUid',
  'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId',
  'firebaseId', 'firebaseAuthId', 'firebase_id',
];
const USER_RECORD_FIELDS = [
  'id', 'userId', 'email', 'segment', 'fullName', 'status', 'isBvMember', 'bvGroupId',
  'role', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];
const PROFILE_FIELDS = [
  ...USER_RECORD_FIELDS,
  'guide', 'bvReportingFacilitatorId', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'bvGroupName',
];

type ScopeIdentityCache = {
  users: Map<string, any>;
  guides: Map<string, any>;
};

function createScopeIdentityCache(): ScopeIdentityCache {
  return { users: new Map(), guides: new Map() };
}

function aliasKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function chunkValues<T>(values: readonly T[], size = FIRESTORE_IN_LIMIT): T[][] {
  const width = Math.max(1, Math.min(size, FIRESTORE_IN_LIMIT));
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += width) {
    batches.push(values.slice(index, index + width));
  }
  return batches;
}

function rememberUser(identity: ScopeIdentityCache, user: any) {
  if (!user || typeof user !== 'object') return;
  for (const alias of [
    user.id, user.userId, user.email, user.uid, user.authUid, user.firebaseUid,
    user.firebaseUserId, user.firebaseAuthUid, user.authId, user.authUserId,
    user.firebaseId, user.firebaseAuthId, user.firebase_id,
  ]) {
    const key = aliasKey(alias);
    if (key) identity.users.set(key, user);
  }
}

function cachedUser(identity: ScopeIdentityCache, ref: unknown) {
  const key = aliasKey(ref);
  return key ? identity.users.get(key) : undefined;
}

function rememberGuide(identity: ScopeIdentityCache, guide: any) {
  if (!guide?.id) return;
  identity.guides.set(String(guide.id), guide);
}

function firstStoredValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

async function findAllIn(
  findAll: (query: any) => Promise<{ records?: any[] }>,
  field: string,
  values: readonly string[],
  fields: string[],
  limit: number,
): Promise<any[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  if (unique.length === 0) return [];
  const results = await Promise.all(chunkValues(unique).map(batch => findAll({
    filters: { [field]: { in: batch } } as any,
    fields,
    limit,
  })));
  return results.flatMap(result => result.records || []);
}

function unseenAliases(identity: ScopeIdentityCache, aliases: readonly string[]): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const alias of aliases) {
    const text = String(alias ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (!cachedUser(identity, text)) missing.push(text);
  }
  return missing;
}

async function rememberFoundUsers(identity: ScopeIdentityCache, aliases: string[], fields: string[]) {
  if (aliases.length === 0 || fields.length === 0) return;
  const batches = chunkValues(aliases);
  const batchResults = await Promise.all(batches.map(async batch => {
    const lists = await Promise.all(fields.map(field => Users.findAll({
      filters: { [field]: { in: batch } } as any,
      fields: USER_RECORD_FIELDS,
      limit: 100,
    })));
    return lists.flatMap(result => result.records || []);
  }));
  for (const users of batchResults) {
    for (const user of users) rememberUser(identity, user);
  }
}

function indexFacilitatorMap(map: Map<string, any>, users: readonly any[]) {
  const seen = new Set<string>();
  for (const user of users) {
    if (!user?.id || seen.has(user.id)) continue;
    seen.add(user.id);
    map.set(user.id, user);
    map.set(String(user.id).toLowerCase(), user);
    if (user.userId) {
      map.set(user.userId, user);
      map.set(String(user.userId).toLowerCase(), user);
    }
    if (user.email) map.set(String(user.email).toLowerCase(), user);
    if (user.fullName) map.set(String(user.fullName).trim().toLowerCase(), user);
  }
}

function facilitatorRoleKind(user: any): 'rgf' | 'rgsf' | 'unknown' {
  if (!user) return 'unknown';
  const role = String(user.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  if (user.isBvFacilitator === true || user.isBvsl === true || ['RGF', 'BVSL', 'FACILITATOR'].includes(role)) return 'rgf';
  if (user.isBvSubFacilitator === true || role === 'RGSF' || role === 'SUB_FACILITATOR') return 'rgsf';
  return 'unknown';
}

async function loadFacilitators(identity: ScopeIdentityCache, facilitatorUserIds: string[]) {
  const facilitatorMap = new Map<string, any>();
  const known = facilitatorUserIds.map(id => cachedUser(identity, id)).filter(Boolean);
  const missing = facilitatorUserIds.filter(id => !cachedUser(identity, id));
  const batchResults = await Promise.all(chunkValues(missing).map(async batch => {
    const [byUserId, byId] = await Promise.all([
      Users.findAll({ filters: { userId: { in: batch } } as any, fields: USER_RECORD_FIELDS, limit: 100 }),
      Users.findAll({ filters: { id: { in: batch } } as any, fields: USER_RECORD_FIELDS, limit: 100 }),
    ]);
    return [...(byUserId.records || []), ...(byId.records || [])];
  }));
  const discovered: any[] = [];
  for (const users of batchResults) {
    for (const user of users) rememberUser(identity, user);
    discovered.push(...users);
  }
  indexFacilitatorMap(facilitatorMap, [...known, ...discovered]);

  const unresolved = facilitatorUserIds.filter(id => !facilitatorMap.has(id));
  if (unresolved.length === 0) return facilitatorMap;

  const guidesById = new Map<string, any>();
  for (const id of unresolved) {
    const cached = identity.guides.get(String(id));
    if (cached) guidesById.set(String(cached.id), cached);
  }
  const loadedGuides = await findAllIn(
    query => Guides.findAll(query),
    'id',
    unresolved.filter(id => !identity.guides.has(String(id))),
    GUIDE_RECORD_FIELDS,
    100,
  );
  for (const guide of loadedGuides) {
    rememberGuide(identity, guide);
    guidesById.set(String(guide.id), guide);
  }
  const legacyGuides = [...guidesById.values()];
  const missingEmails = [...new Set(legacyGuides.map(guide => String(guide.email || '').trim()).filter(Boolean))]
    .filter(email => !cachedUser(identity, email));
  const linkedUsers = await findAllIn(
    query => Users.findAll(query),
    'email',
    missingEmails,
    USER_RECORD_FIELDS,
    100,
  );
  for (const user of linkedUsers) rememberUser(identity, user);
  for (const guide of legacyGuides) {
    const linkedUser = guide.email ? cachedUser(identity, guide.email) : undefined;
    const resolved = linkedUser || {
      id: guide.id,
      userId: guide.guideId,
      fullName: guide.fullName,
      segment: guide.segment,
    };
    facilitatorMap.set(guide.id, resolved);
    if (guide.guideId) facilitatorMap.set(guide.guideId, resolved);
  }
  return facilitatorMap;
}

async function loadGuideNames(identity: ScopeIdentityCache, guideIds: string[]) {
  const missing = guideIds.filter(id => !identity.guides.has(String(id)));
  const loaded = await findAllIn(query => Guides.findAll(query), 'id', missing, GUIDE_RECORD_FIELDS, 100);
  for (const guide of loaded) rememberGuide(identity, guide);
  const guideMap = new Map<string, any>();
  for (const id of guideIds) {
    const guide = identity.guides.get(String(id));
    if (guide) guideMap.set(guide.id, guide);
  }
  return guideMap;
}

async function loadMemberships(groups: readonly any[]): Promise<any[]> {
  const refs = [...new Set(groups.flatMap(group =>
    [group?.id, group?.groupId].filter(Boolean).map((value: unknown) => String(value)),
  ))];
  if (refs.length === 0) return [];
  const [byGroup, byGroupId] = await Promise.all([
    findAllIn(query => BvGroupMembers.findAll(query), 'group', refs, MEMBERSHIP_FIELDS, 5000),
    findAllIn(query => BvGroupMembers.findAll(query), 'groupId', refs, MEMBERSHIP_FIELDS, 5000),
  ]);
  const membershipMap = new Map<string, any>();
  for (const membership of [...byGroup, ...byGroupId]) {
    membershipMap.set(String(membership.id), membership);
  }
  return [...membershipMap.values()];
}

async function loadMemberIdentities(identity: ScopeIdentityCache, aliases: string[]) {
  const pending = unseenAliases(identity, aliases);
  if (pending.length === 0) return;
  // id and userId resolve current memberships. Email and auth-id fields are
  // only read for aliases that those two fields did not already match.
  await rememberFoundUsers(identity, pending, ['userId', 'id']);
  const unresolved = unseenAliases(identity, pending);
  if (unresolved.length === 0) return;
  const emails = unresolved.filter(alias => alias.includes('@'));
  await rememberFoundUsers(identity, emails, ['email']);
  const authAliases = unresolved.filter(alias => !alias.includes('@') && !cachedUser(identity, alias));
  const secondary = USER_LOOKUP_FIELDS.filter(field => field !== 'userId' && field !== 'id' && field !== 'email');
  await rememberFoundUsers(identity, authAliases, secondary);
}

const groupSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  description: z.string(),
  memberCount: z.number(),
  totalSessions: z.number(),
  presentToday: z.number(),
  joinToken: z.string().nullable(),
  bvslName: z.string().nullable(),
  rgsfName: z.string().nullable(),
  guideName: z.string().nullable(),
  meetingTime: z.string().nullable().optional(),
  segment: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  facilitatorIds: z.array(z.string()),
  rgfIds: z.array(z.string()),
  rgsfIds: z.array(z.string()),
});

export default createEndpoint({
  description: 'Get BV groups led by a BVSL (with member count, session count, today attendance)',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(), // custom userId field value
    viewRole: z.enum(['RGF', 'RGSF']).optional(),
  }),
  outputSchema: z.object({
    groups: z.array(groupSchema),
    pendingRequestCount: z.number(),
    error: z.string().nullable(),
  }),
  execute: async ({ input, context }: any) => {
    const identity = createScopeIdentityCache();
    let groupRecords: any[] = [];
    let defaultBvslName = 'RGF';
    const isRgsfRequest = input.viewRole === 'RGSF';
    let rgsfCallerKeys = new Set<string>();
    let rgsfParentKeys = new Set<string>();
    let callerKeys = new Set<string>();
    let userRecord: any = null;

    if (input.bvslId === 'ALL' || !input.bvslId) {
      if (!isBvSuperAdminUser(context?.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Viewing all BV groups requires super admin access' });
      }
      const { records } = await BvGroups.findAll({ limit: 500 });
      groupRecords = records;
    } else {
      userRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: PROFILE_FIELDS })
        ?? await Users.findOne({ id: input.bvslId, fields: PROFILE_FIELDS });
      rememberUser(identity, userRecord);
      
      const dbUserId = userRecord?.id || input.bvslId;
      const parentRgfId = (userRecord as any)?.bvReportingFacilitatorId;
      defaultBvslName = userRecord?.fullName || '';
      const isRgsfView = input.viewRole === 'RGSF';
 
      const { records } = await BvGroups.findAll({
        limit: 1000,
      });
      callerKeys = new Set(
        [
          input.bvslId,
          dbUserId,
          userRecord?.userId,
          userRecord?.email,
          userRecord?.fullName,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      );
      const assignedGroupRefs = new Set(
        [userRecord?.bvGroupId, userRecord?.bvGroupName]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      );
      rgsfCallerKeys = callerKeys;

      // RGSFs inherit the full group scope of their reporting RGF. Resolve
      // every parent alias because groups created at different times may
      // store a Firestore id, public userId, or email.
      const parentRgfKeys = new Set<string>();
      if (parentRgfId) parentRgfKeys.add(String(parentRgfId).toLowerCase());
      if (parentRgfId) {
        const parent = await Users.findOne({ filters: { userId: String(parentRgfId) }, fields: PROFILE_FIELDS }) ||
          await Users.findOne({ id: String(parentRgfId), fields: PROFILE_FIELDS }) ||
          await Users.findOne({ filters: { email: String(parentRgfId) }, fields: PROFILE_FIELDS });
        [parent?.id, parent?.userId, parent?.email].filter(Boolean).forEach(value => parentRgfKeys.add(String(value).toLowerCase()));
        rememberUser(identity, parent);
      }
      rgsfParentKeys = parentRgfKeys;

      // RGSF dashboard shows all groups facilitated by its reporting RGF,
      // while retaining direct assignments for legacy group records.
      groupRecords = records.filter((g: any) => {
        if (g.isActive === false) return false;

        const owners = ownerKeys(g);
        const groupRefs = [g.id, g.groupId, g.groupName].filter(Boolean).map((value: unknown) => String(value).toLowerCase());
        const assignedToCaller = groupRefs.some((value: string) => assignedGroupRefs.has(value));
        const subFacilitatorValues = [
          g.subFacilitatorId,
          g.rgsfId,
          g.subFacilitator,
        ].flatMap((value) => Array.isArray(value) ? value : [value])
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());

        if (isRgsfView) {
          const isParentGroup = owners.some((value) => parentRgfKeys.has(value));
          const isCallerOwnedLegacyGroup = owners.some((value) => callerKeys.has(value));
          return isParentGroup || isCallerOwnedLegacyGroup || subFacilitatorValues.some((value) => callerKeys.has(value)) || assignedToCaller;
        }

        return (
          owners.some(value => callerKeys.has(value)) ||
          assignedToCaller ||
          subFacilitatorValues.some((value) => callerKeys.has(value)) ||
          (!!parentRgfId && owners.some(value => value === String(parentRgfId).toLowerCase()))
        );
      });
    }

    if (!isBvSuperAdminUser(context.user)) {
      const allowedGroups = await resolveBvScopedGroups(context.user);
      const allowed = new Set(allowedGroups.map(group => group.id));
      const selfAliases = [context.user?.id, context.user?.userId, context.user?.email, context.user?.fullName]
        .filter(Boolean)
        .map((value: unknown) => String(value).toLowerCase());
      const viewingOwnGroups = selfAliases.some((alias: string) => callerKeys.has(alias));
      if (viewingOwnGroups) {
        const seen = new Set(groupRecords.map((group: any) => String(group.id || '')));
        for (const group of allowedGroups) {
          if (!seen.has(group.id)) {
            groupRecords.push(group.record);
            seen.add(group.id);
          }
        }
      }
      groupRecords = groupRecords.filter(group => allowed.has(group.id));
    }
    const dedupedGroupRecords = new Map<string, any>();
    const rgsfGroupPriority = (group: any): number => {
      const ownerValues = [group.bvslLeader, group.bvslId]
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const subValues = [group.subFacilitatorId, group.rgsfId, group.subFacilitator]
        .flatMap((value) => Array.isArray(value) ? value : [value])
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (ownerValues.some(value => rgsfCallerKeys.has(value))) return 3;
      if (subValues.some(value => rgsfCallerKeys.has(value))) return 2;
      if (ownerValues.some(value => rgsfParentKeys.has(value))) return 1;
      return 0;
    };
    for (const group of groupRecords) {
      const ownerKey = String(group.bvslId || group.bvslLeader || '').toLowerCase();
      const timeKey = String(group.meetingTime || group.preferredTimeSlot || '').toLowerCase();
      const normalizedName = String(group.groupName || '').trim().toLowerCase();
      // One RGF can facilitate several groups, including groups that share a
      // name. Collapse only duplicate copies of the same group id.
      const stableId = String(group.groupId || group.id || '').toLowerCase();
      const groupKey = stableId || `${normalizedName}|${ownerKey}|${timeKey}`;
      if (!groupKey) continue;
      const existing = dedupedGroupRecords.get(groupKey);
      if (
        !existing ||
        (existing.isActive === false && group.isActive !== false) ||
        (isRgsfRequest && rgsfGroupPriority(group) > rgsfGroupPriority(existing))
      ) {
        dedupedGroupRecords.set(groupKey, group);
      }
    }
    groupRecords = Array.from(dedupedGroupRecords.values());

    if (groupRecords.length === 0) return { groups: [], pendingRequestCount: 0, error: null };

    const isAll = input.bvslId === 'ALL' || !input.bvslId;
    const todayDate = getTodayIST();

    // Facilitator, guide, and member identity share one cache for this request.
    // Firestore `in` filters stay at or below 30 values. Member auth-id fields
    // are read only for aliases that id, userId, and email did not resolve.
    const facilitatorUserIds = [...new Set(groupRecords.flatMap((group: any) =>
      textList(group.bvslId).concat(
        textList(group.bvslLeader),
        textList(group.subFacilitatorId),
        textList(group.rgsfId),
      ),
    ))] as string[];
    const guideIds = [...new Set(groupRecords.map((group: any) =>
      Array.isArray(group.guide) ? group.guide[0] : group.guide,
    ).filter(Boolean))] as string[];
    const membershipPromise = loadMemberships(groupRecords);
    const facilitatorMap = await loadFacilitators(identity, facilitatorUserIds);
    const memberships = await membershipPromise;
    const memberAliases = [...new Set(memberships.flatMap(membership => [
      firstStoredValue(membership.user),
      firstStoredValue(membership.userId),
      firstStoredValue(membership.memberId),
    ]).filter(Boolean))];
    const [guideMap] = await Promise.all([
      loadGuideNames(identity, guideIds),
      loadMemberIdentities(identity, memberAliases),
    ]);

    const memberIdsByGroup = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const groupRec = [firstStoredValue(membership.group), firstStoredValue(membership.groupId)]
        .filter(Boolean)
        .map(groupRef => groupRecords.find((group: any) =>
          String(group.id || '').toLowerCase() === groupRef.toLowerCase() ||
          String(group.groupId || '').toLowerCase() === groupRef.toLowerCase()
        ))
        .find(Boolean);
      if (!groupRec) continue;

      const uid = firstStoredValue(membership.user);
      const altUid = firstStoredValue(membership.userId);
      const legacyMemberId = firstStoredValue(membership.memberId);
      const user = cachedUser(identity, uid) || cachedUser(identity, altUid) || cachedUser(identity, legacyMemberId);
      const isActiveUser = !user?.status || String(user.status).toLowerCase() === 'active';
      const groupAliases = new Set([groupRec.id, groupRec.groupId].filter(Boolean).map((value: unknown) => String(value).toLowerCase()));
      const profileGroupId = firstStoredValue(user?.bvGroupId).toLowerCase();
      const isCurrentGroup = !profileGroupId || groupAliases.has(profileGroupId);
      const isBvMember = user?.isBvMember !== false;

      // Keep legacy records with missing profile fields, but never count an
      // inactive, explicitly removed, or reassigned user from a stale row.
      if (user && isActiveUser && isBvMember && isCurrentGroup) {
        const canonicalUserId = String(user.id || user.userId || uid || altUid || legacyMemberId);
        if (!memberIdsByGroup.has(groupRec.id)) memberIdsByGroup.set(groupRec.id, new Set());
        memberIdsByGroup.get(groupRec.id)!.add(canonicalUserId);
      }
    }

    const groups = await Promise.all(groupRecords.map(async (g) => {
      const facilitatorRefs = textList(g.bvslId).concat(textList(g.bvslLeader));
      const matchedFacilitators: any[] = [];
      const seenFacilitators = new Set<string>();
      for (const ref of facilitatorRefs) {
        const user = facilitatorMap.get(ref) || facilitatorMap.get(ref.toLowerCase());
        if (!user?.id || seenFacilitators.has(user.id)) continue;
        seenFacilitators.add(user.id);
        matchedFacilitators.push(user);
      }
      const facilitatorUser = matchedFacilitators.find(user => facilitatorRoleKind(user) === 'rgf' && user?.fullName)
        || matchedFacilitators.find(user => user?.fullName)
        || matchedFacilitators[0];
      const viewerKind = facilitatorRoleKind(userRecord);
      const rgfNames: string[] = [];
      const rgsfNames: string[] = [];
      const usedNames = new Set<string>();
      const lookupUser = (ref: unknown) => {
        const key = String(ref || '').trim();
        if (!key) return undefined;
        return facilitatorMap.get(key) || facilitatorMap.get(key.toLowerCase());
      };
      const rememberLabel = (user: any, fallbackName: string, keys: unknown[]) => {
        const label = String(user?.fullName || fallbackName || '').trim();
        if (!label) return;
        const nameKey = label.toLowerCase();
        if (usedNames.has(nameKey)) return;
        let kind = facilitatorRoleKind(user);
        const matchesViewer = keys.some(key => callerKeys.has(String(key || '').trim().toLowerCase()));
        // The signed-in RGSF can still be stored on the group from when they were an RGF.
        if (kind !== 'rgf' && viewerKind === 'rgsf' && matchesViewer) kind = 'rgsf';
        usedNames.add(nameKey);
        if (kind === 'rgsf') rgsfNames.push(label);
        else rgfNames.push(label);
      };
      for (const slot of readGroupFacilitators(g)) {
        const user = lookupUser(slot.id) || lookupUser(slot.userId) || lookupUser(slot.name);
        rememberLabel(user, slot.name, [slot.id, slot.userId, slot.name, user?.id, user?.userId, user?.email, user?.fullName]);
      }
      for (const ref of [...textList(g.subFacilitatorId), ...textList(g.rgsfId), ...textList(g.subFacilitator)]) {
        const user = lookupUser(ref);
        rememberLabel(user, user?.fullName || '', [ref, user?.id, user?.userId, user?.email, user?.fullName]);
      }
      for (const storedName of textList(g.bvslName)) {
        const parts = storedName.includes(',') ? storedName.split(',').map(part => part.trim()).filter(Boolean) : [storedName];
        for (const part of parts) {
          if (usedNames.has(part.toLowerCase())) continue;
          const user = lookupUser(part);
          rememberLabel(user, part, [part, user?.id, user?.userId, user?.email, user?.fullName]);
        }
      }
      const facilitatorName = joinFacilitatorNames(rgfNames);
      const rgsfName = joinFacilitatorNames(rgsfNames);
      const groupSegment = String(g.segment || facilitatorUser?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
      if ((groupSegment === 'PW' || groupSegment === 'PRABHUPADAWORLD') && facilitatorRoleKind(facilitatorUser) === 'rgf' && !(memberIdsByGroup.get(g.id)?.size)) {
        const countedIds = memberIdsByGroup.get(g.id) || new Set<string>();
        const alreadyCounted = bvUserAliases(facilitatorUser).some(alias => {
          const known = cachedUser(identity, alias);
          const canonical = String(known?.id || known?.userId || alias);
          return countedIds.has(canonical) || countedIds.has(alias);
        });
        if (!alreadyCounted) {
          countedIds.add(String(facilitatorUser.id || facilitatorUser.userId));
          memberIdsByGroup.set(g.id, countedIds);
        }
      }
      const guideRes = guideMap.get(Array.isArray(g.guide) ? g.guide[0] : g.guide);
      
      let totalSessions = 0;
      let presentToday = 0;

      // Only fetch attendance stats if it's not the ALL view (to save API calls)
      if (!isAll) {
        const attendanceGroupRefs = [...new Set([g.id, g.groupId].filter(Boolean))];
        const [allGroupAtt, todayPresentAtt] = await Promise.all([
          BvAttendance.findAll({ filters: { group: attendanceGroupRefs.length > 1 ? { in: attendanceGroupRefs } : g.id } as any, fields: ['attendanceDate'], limit: 2000 }),
          BvAttendance.findAll({ filters: { group: attendanceGroupRefs.length > 1 ? { in: attendanceGroupRefs } : g.id, attendanceDate: todayDate, present: true } as any, fields: ['id'], limit: 200 }),
        ]);
        const distinctDates = new Set(allGroupAtt.records.map((a: any) => a.attendanceDate).filter(Boolean));
        totalSessions = distinctDates.size;
        presentToday = todayPresentAtt.records.length;
      }

      return {
        id: g.id,
        groupId: g.groupId || g.id,
        groupName: g.groupName || '',
        description: g.description || '',
        memberCount: memberIdsByGroup.get(g.id)?.size || 0,
        totalSessions,
        presentToday,
        joinToken: g.joinToken || null,
        bvslName: facilitatorName || (viewerKind === 'rgsf' ? null : defaultBvslName || null),
        rgsfName: rgsfName || null,
        guideName: guideRes?.fullName || null,
        meetingTime: g.meetingTime || g.preferredTimeSlot || null,
        // Facilitator ownership is authoritative. This also repairs the
        // display of groups created before createBvGroup resolved custom IDs.
        segment: String(facilitatorUser?.segment || g.segment || 'PW').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW',
        isActive: g.isActive ?? true,
        facilitatorIds: [...new Set(
          [
            g.bvslLeader,
            g.bvslId,
            g.bvslName,
            g.subFacilitatorId,
            g.rgsfId,
            g.subFacilitator,
            ...matchedFacilitators.flatMap(user => [user?.id, user?.userId, user?.email, user?.fullName]),
          ]
            .flatMap((value: unknown) => textList(value))
            .map((value: string) => value.trim())
            .filter(Boolean),
        )],
        rgfIds: [...new Set(
          [
            g.bvslLeader,
            g.bvslId,
            g.bvslName,
            ...matchedFacilitators.flatMap(user => [user?.id, user?.userId, user?.email, user?.fullName]),
          ]
            .flatMap((value: unknown) => textList(value))
            .map((value: string) => value.trim())
            .filter(Boolean),
        )],
        rgsfIds: [...new Set(
          [g.subFacilitatorId, g.rgsfId, g.subFacilitator]
            .flatMap((value: unknown) => textList(value))
            .map((value: string) => value.trim())
            .filter(Boolean),
        )],
      };
    }));

    // Count pending join requests (only if not ALL view)
    let pendingRequestCount = 0;
    if (!isAll) {
      for (const g of groupRecords) {
        const { records: reqs } = await BvGroupRequests.findAll({
          filters: { group: g.id, status: 'Pending' },
          limit: 100,
          fields: ['id'],
        });
        pendingRequestCount += reqs.length;
      }
    }

    return { groups, pendingRequestCount, error: null };
  },
});
