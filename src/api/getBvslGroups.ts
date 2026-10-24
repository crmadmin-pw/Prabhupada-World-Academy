import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, BvGroupRequests, Guides, Users, AppError } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { bvUserAliases, isBvSuperAdminUser, resolveBvScopedGroups } from '../lib/bvGroupMemberScope';
import { organizationalDepartment } from '../lib/directoryDepartment';
import { countsAsGroupMember, joinFacilitatorNames, readGroupFacilitators, textList } from '@/lib/bvGroupFacilitators';

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
  supervisorIds: z.array(z.string()),
  supervisorName: z.string(),
});

export default createEndpoint({
  description: 'Get BV groups led by a BVSL (with member count, session count, today attendance)',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(), // custom userId field value
    viewRole: z.enum(['RGF', 'RGSF']).optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
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
    let callerKeys = new Set<string>();
    let userRecord: any = null;

    // The caller's own authorized group scope depends only on the signed-in
    // user, so it resolves alongside the lookups below instead of after them.
    const scopedGroupsPromise = isBvSuperAdminUser(context.user)
      ? null
      : resolveBvScopedGroups(context.user, { includeInactive: true });
    void scopedGroupsPromise?.catch(() => {});

    if (input.bvslId === 'ALL' || !input.bvslId) {
      if (!isBvSuperAdminUser(context?.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Viewing all BV groups requires super admin access' });
      }
      const { records } = await BvGroups.findAll({ limit: 500 });
      groupRecords = records;
    } else {
      // The group catalogue does not depend on the caller record; read both together.
      const catalogueRead = BvGroups.findAll({ limit: 1000 });
      void catalogueRead.catch(() => {});
      userRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: PROFILE_FIELDS })
        ?? await Users.findOne({ id: input.bvslId, fields: PROFILE_FIELDS });
      rememberUser(identity, userRecord);
      
      const dbUserId = userRecord?.id || input.bvslId;
      defaultBvslName = userRecord?.fullName || '';
      const isRgsfView = input.viewRole === 'RGSF';
 
      const { records } = await catalogueRead;
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

      // Reporting to an RGF does not assign their other groups.
      groupRecords = records.filter((g: any) => {
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
          const isCallerOwnedLegacyGroup = owners.some((value) => callerKeys.has(value));
          return isCallerOwnedLegacyGroup || subFacilitatorValues.some((value) => callerKeys.has(value)) || assignedToCaller;
        }

        return (
          owners.some(value => callerKeys.has(value)) ||
          assignedToCaller ||
          subFacilitatorValues.some((value) => callerKeys.has(value))
        );
      });
    }

    if (scopedGroupsPromise) {
      const allowedGroups = await scopedGroupsPromise;
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
    // Attendance statistics and pending join requests are not read for the
    // ALL view. For a facilitator they are read for all of their groups at
    // once (30 group references per query) and attributed per group below,
    // instead of two attendance reads and one request read per group.
    const attendanceStatsPromise = isAll ? null : loadAttendanceStats(groupRecords, todayDate);
    const pendingRequestsPromise = isAll ? null : loadPendingRequestCount(groupRecords);
    void attendanceStatsPromise?.catch(() => {});
    void pendingRequestsPromise?.catch(() => {});

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
    const countedAliasesByGroup = new Map<string, Set<string>>();
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
      if (countsAsGroupMember(user, groupRec)) {
        const canonicalUserId = String(user.id || user.userId || uid || altUid || legacyMemberId);
        if (!memberIdsByGroup.has(groupRec.id)) memberIdsByGroup.set(groupRec.id, new Set());
        memberIdsByGroup.get(groupRec.id)!.add(canonicalUserId);
        if (!countedAliasesByGroup.has(groupRec.id)) countedAliasesByGroup.set(groupRec.id, new Set());
        const counted = countedAliasesByGroup.get(groupRec.id)!;
        counted.add(canonicalUserId.toLowerCase());
        if (user) bvUserAliases(user).forEach(alias => counted.add(alias));
        [uid, altUid, legacyMemberId].forEach(alias => {
          const key = String(alias || '').trim().toLowerCase();
          if (key) counted.add(key);
        });
      }
    }
    for (const groupRec of groupRecords) {
      if (!memberIdsByGroup.has(groupRec.id)) memberIdsByGroup.set(groupRec.id, new Set());
      if (!countedAliasesByGroup.has(groupRec.id)) countedAliasesByGroup.set(groupRec.id, new Set());
      const ids = memberIdsByGroup.get(groupRec.id)!;
      const counted = countedAliasesByGroup.get(groupRec.id)!;
      const staffRefs = [
        ...textList(groupRec.bvslLeader),
        ...textList(groupRec.bvslId),
        ...textList(groupRec.subFacilitatorId),
        ...textList(groupRec.rgsfId),
        ...textList(groupRec.subFacilitator),
      ];
      for (const ref of staffRefs) {
        const user = facilitatorMap.get(ref) || facilitatorMap.get(String(ref).toLowerCase());
        if (!user?.id) continue;
        if (user.status && String(user.status).toLowerCase() !== 'active') continue;
        const aliases = bvUserAliases(user);
        if (aliases.some(alias => counted.has(alias)) || ids.has(String(user.id))) continue;
        ids.add(String(user.id));
        aliases.forEach(alias => counted.add(alias));
      }
    }

    const attendanceStats = attendanceStatsPromise ? await attendanceStatsPromise : null;
    const groups = groupRecords.map((g) => {
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
      const explicitDepartment = organizationalDepartment(facilitatorUser) || organizationalDepartment({ segment: g.segment });
      const guideRes = guideMap.get(Array.isArray(g.guide) ? g.guide[0] : g.guide);
      
      // Only present outside the ALL view (to save API calls)
      const stats = attendanceStats?.get(String(g.id));
      const totalSessions = stats?.sessionDates.size || 0;
      const presentToday = stats?.presentToday || 0;

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
        guideDepartment: organizationalDepartment(guideRes),
        meetingTime: g.meetingTime || g.preferredTimeSlot || null,
        // Facilitator ownership is authoritative. This also repairs the
        // display of groups created before createBvGroup resolved custom IDs.
        segment: explicitDepartment || (String(facilitatorUser?.segment || g.segment || 'PW').toUpperCase() === 'FOLK' ? 'FOLK' : 'PW'),
        explicitDepartment,
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
        supervisorIds: [...new Set(
          [g.supervisorId, g.supervisorUserId]
            .flatMap((value: unknown) => textList(value))
            .map((value: string) => value.trim())
            .filter(Boolean),
        )],
        supervisorName: textList([g.supervisorId, g.supervisorUserId]).length ? String(g.supervisorName || '') : '',
      };
    });

    // Count pending join requests (only if not ALL view)
    const pendingRequestCount = pendingRequestsPromise ? await pendingRequestsPromise : 0;

    const callerDepartment = organizationalDepartment(context?.user);
    const isolatedGroups = callerDepartment
      ? groups.filter(group => !group.explicitDepartment || group.explicitDepartment === callerDepartment)
      : groups;
    const visibleGroups = isolatedGroups.map(group => {
      const { explicitDepartment: _explicitDepartment, guideDepartment, ...visible } = group;
      if (callerDepartment && guideDepartment && guideDepartment !== callerDepartment) visible.guideName = null;
      return visible;
    });

    return { groups: visibleGroups, pendingRequestCount, error: null };
  },
});

type AttendanceStats = { sessionDates: Set<string>; presentToday: number };

/** Per-group distinct session dates (at most 2000 rows per group, as before)
 * and today's present count (at most 200 per group, as before), read for all
 * groups together. Rows are attributed by their stored group reference. */
async function loadAttendanceStats(groupRecords: readonly any[], todayDate: string): Promise<Map<string, AttendanceStats>> {
  const stats = new Map<string, AttendanceStats>();
  // A reference normally names one group; a legacy record may reuse another
  // group's reference, in which case the row counts for both, as before.
  const groupsByRef = new Map<string, string[]>();
  for (const group of groupRecords) {
    const id = String(group.id);
    stats.set(id, { sessionDates: new Set(), presentToday: 0 });
    for (const ref of new Set([group.id, group.groupId].filter(Boolean).map(String))) {
      groupsByRef.set(ref, [...(groupsByRef.get(ref) || []), id]);
    }
  }
  const refs = [...groupsByRef.keys()];
  if (refs.length === 0) return stats;
  const batches = chunkValues(refs);
  const groupsPerBatch = (batch: string[]) => new Set(batch.flatMap(ref => groupsByRef.get(ref) || [])).size;
  const [sessionPages, todayPages] = await Promise.all([
    Promise.all(batches.map(batch => BvAttendance.findAll({
      filters: { group: batch.length > 1 ? { in: batch } : batch[0] } as any,
      fields: ['group', 'attendanceDate'],
      limit: 2000 * groupsPerBatch(batch),
    }))),
    Promise.all(batches.map(batch => BvAttendance.findAll({
      filters: { group: batch.length > 1 ? { in: batch } : batch[0], attendanceDate: todayDate, present: true } as any,
      fields: ['id', 'group'],
      limit: 200 * groupsPerBatch(batch),
    }))),
  ]);
  const rowCounts = new Map<string, number>();
  for (const page of sessionPages) {
    for (const row of page.records) {
      for (const id of groupsByRef.get(firstStoredValue(row.group)) || []) {
        const seen = (rowCounts.get(id) || 0) + 1;
        rowCounts.set(id, seen);
        if (seen > 2000) continue;
        if (row.attendanceDate) stats.get(id)!.sessionDates.add(String(row.attendanceDate));
      }
    }
  }
  for (const page of todayPages) {
    for (const row of page.records) {
      for (const id of groupsByRef.get(firstStoredValue(row.group)) || []) {
        const entry = stats.get(id);
        if (entry && entry.presentToday < 200) entry.presentToday += 1;
      }
    }
  }
  return stats;
}

/** Pending join requests across all groups, at most 100 per group as before. */
async function loadPendingRequestCount(groupRecords: readonly any[]): Promise<number> {
  const groupIds = [...new Set(groupRecords.map(group => String(group.id || '')).filter(Boolean))];
  if (groupIds.length === 0) return 0;
  const pages = await Promise.all(chunkValues(groupIds).map(batch => BvGroupRequests.findAll({
    filters: { group: batch.length > 1 ? { in: batch } : batch[0], status: 'Pending' } as any,
    fields: ['id', 'group'],
    limit: 100 * batch.length,
  })));
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const row of page.records) {
      const id = firstStoredValue(row.group);
      counts.set(id, Math.min(100, (counts.get(id) || 0) + 1));
    }
  }
  let total = 0;
  for (const id of groupIds) total += counts.get(id) || 0;
  return total;
}
