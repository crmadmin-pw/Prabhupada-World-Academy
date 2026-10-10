import { AppError, BvGroups, BvGroupMembers, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, isHierarchyAdmin, isUserInHierarchy, hierarchyRefs, readScopedUsers } from './hierarchyUtils';

const IDENTITY_FIELDS = [
  'id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
  'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
  // Pre-migration BV groups and preaching entries stored the facilitator's
  // display name rather than a Users document ID. Keep those historic rows
  // visible in the current RGF reports while all new writes use canonical IDs.
  'fullName', 'displayName', 'name',
];
const PROFILE_RESOLUTION_FIELDS = ['fullName', 'displayName', 'name', 'status'];
type UserRecord = Record<string, unknown>;

export interface BvGroupScopeOptions {
  groupId?: string;
  segment?: 'FOLK' | 'PW';
  /** Report screens should show people under the caller, not the caller. */
  excludeCaller?: boolean;
}

export interface BvScopedGroup {
  id: string;
  groupId: string;
  groupName: string;
  record: UserRecord;
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

export function bvUserAliases(user: UserRecord | null | undefined): string[] {
  return [...new Set(IDENTITY_FIELDS.flatMap(field => refs(user?.[field])))];
}

/** Identity aliases that identify the RGF/RGSF responsible for a BV group. */
export function bvGroupFacilitatorAliases(group: UserRecord): string[] {
  return refs([
    group.bvslLeader,
    group.bvslId,
    group.subFacilitatorId,
    group.rgsfId,
    group.subFacilitator,
  ]);
}

function profileName(user: UserRecord | null | undefined): string {
  return String(user?.fullName || user?.displayName || user?.name || '').trim();
}

function profileEmail(user: UserRecord | null | undefined): string {
  return String(user?.email || '').trim();
}

function profileQuality(user: UserRecord | null | undefined): number {
  return (profileName(user) ? 8 : 0) +
    (profileEmail(user) ? 4 : 0) +
    (String(user?.userId || '').trim() ? 2 : 0) +
    (String(user?.status || '').trim().toLowerCase() === 'active' ? 1 : 0);
}

function roleValue(user: UserRecord | null | undefined): string {
  return String(user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
}

export function isBvDepartmentAdmin(user: UserRecord | null | undefined): boolean {
  const role = roleValue(user);
  return !!(user?.isBvAdmin || user?.isBvSuperAdmin || user?.isPwAdmin ||
    role === 'ADMIN' || role === 'PW_ADMIN' || role === 'SUPER_ADMIN' || role === 'SUPER_GUIDE');
}

/** Only these users may request every BV group in a department. */
export function isBvSuperAdminUser(user: UserRecord | null | undefined): boolean {
  const role = roleValue(user);
  return !!(user?.isBvSuperAdmin || role === 'SUPER_ADMIN' || role === 'SUPER_GUIDE');
}

function departmentValue(value: unknown): 'FOLK' | 'PW' | null {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  if (normalized === 'FOLK') return 'FOLK';
  return null;
}

function groupAliases(group: UserRecord): string[] {
  return refs([group.id, group.groupId]);
}

async function resolveCanonicalUsersByAliases(
  targetAliases: Set<string>,
  userFields: string[],
): Promise<UserRecord[]> {
  if (targetAliases.size === 0) return [];

  const requestedFields = [...new Set([...userFields, ...IDENTITY_FIELDS, ...PROFILE_RESOLUTION_FIELDS])];
  const { records: allUsers } = await Users.findAll({ fields: requestedFields, limit: 5000 });
  const candidates = allUsers.filter(user =>
    bvUserAliases(user).some(alias => targetAliases.has(alias))
  );

  // Treat every shared canonical identity alias as an edge. Connected
  // components handle transitive legacy duplicates (A shares userId with B,
  // while B shares auth UID with C) that greedy alias claiming can miss.
  const parent = candidates.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const aliasOwner = new Map<string, number>();
  candidates.forEach((user, index) => {
    for (const alias of bvUserAliases(user)) {
      const owner = aliasOwner.get(alias);
      if (owner === undefined) aliasOwner.set(alias, index);
      else union(index, owner);
    }
  });

  const canonicalUsers = new Map<number, UserRecord>();
  candidates.forEach((user, index) => {
    // Alias-only placeholder documents can connect legacy identities, but
    // must never become a visible report or 1:1 profile themselves.
    if (!profileName(user) && !profileEmail(user)) return;
    const root = find(index);
    const current = canonicalUsers.get(root);
    if (!current || profileQuality(user) > profileQuality(current)) {
      canonicalUsers.set(root, user);
    }
  });
  return [...canonicalUsers.values()];
}

export async function resolveBvUsersByAliases(
  aliases: Iterable<string>,
  userFields: string[],
): Promise<UserRecord[]> {
  return resolveCanonicalUsersByAliases(new Set([...aliases].flatMap(refs)), userFields);
}

export async function resolveBvDepartmentGroups(
  segment: 'FOLK' | 'PW',
  groupId?: string,
): Promise<BvScopedGroup[]> {
  const { records: allGroups } = await BvGroups.findAll({
      fields: ['id', 'groupId', 'groupName', 'description', 'segment', 'guide', 'isActive', 'bvslLeader', 'bvslId', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
      limit: 1000,
  });
  const requestedGroup = groupId ? new Set(refs(groupId)) : null;
  const needsLegacyDepartment = allGroups.some(group => group.isActive !== false &&
    (!requestedGroup || groupAliases(group).some(alias => requestedGroup.has(alias))) && !departmentValue(group.segment));
  // Explicit department fields are already authoritative. Only old groups
  // without one need a facilitator-directory scan to infer the department.
  const allUsers = needsLegacyDepartment ? (await Users.findAll({
    fields: [...IDENTITY_FIELDS, 'segment', 'isPrabhupadaWorldUser'], limit: 5000,
  })).records : [];
  const segmentByUserAlias = new Map<string, 'FOLK' | 'PW'>();
  for (const user of allUsers) {
    const userSegment = departmentValue(user.segment) || (user.isPrabhupadaWorldUser === true ? 'PW' : null);
    if (userSegment) bvUserAliases(user).forEach(alias => segmentByUserAlias.set(alias, userSegment));
  }
  return allGroups.filter(group => {
    if (group.isActive === false) return false;
    if (requestedGroup && !groupAliases(group).some(alias => requestedGroup.has(alias))) return false;
    const explicit = departmentValue(group.segment);
    const facilitatorSegments = bvGroupFacilitatorAliases(group)
      .map(alias => segmentByUserAlias.get(alias))
      .filter(Boolean);
    const groupSegment = explicit || facilitatorSegments[0];
    return groupSegment === segment;
  }).map(group => ({
    id: String(group.id || ''),
    groupId: String(group.groupId || group.id || ''),
    groupName: String(group.groupName || 'Reading Group'),
    record: group,
  })).filter(group => !!group.id);
}

export async function resolveBvDepartmentFacilitatorUsers(
  segment: 'FOLK' | 'PW',
  userFields: string[],
  groupId?: string,
): Promise<UserRecord[]> {
  const groups = await resolveBvDepartmentGroups(segment, groupId);
  return resolveCanonicalUsersByAliases(
    new Set(groups.flatMap(group => bvGroupFacilitatorAliases(group.record))),
    userFields,
  );
}

/**
 * Resolve the active BV groups the caller is permitted to monitor.
 * Supervisors inherit groups from RGFs that report to them. RGF/RGSF behavior
 * remains identical to the existing dashboards.
 */
export async function resolveBvScopedGroups(
  contextUser: UserRecord,
  options: BvGroupScopeOptions = {},
): Promise<BvScopedGroup[]> {
  if (isHierarchyAdmin(contextUser)) {
    const scope = await getScopedHierarchyUserIds(contextUser);
    const groups = options.segment
      ? await resolveBvDepartmentGroups(options.segment)
      : (await BvGroups.findAll({ limit: 5000 })).records.filter(g => g.isActive !== false).map(record => ({
        id: String(record.id), groupId: String(record.groupId || record.id), groupName: String(record.groupName || ''), record,
      }));
    const permitted = groups.filter(({ record }) => {
      if (scope === null) return true;
      const guides = hierarchyRefs(record.guide);
      if (guides.length && !guides.some(ref => scope.has(ref))) return false;
      return hierarchyRefs([record.guide, record.bvslLeader, record.bvslId, record.subFacilitatorId, record.rgsfId, record.subFacilitator])
        .some(ref => scope.has(ref));
    });
    if (!options.groupId) return permitted;
    const requested = new Set(refs(options.groupId));
    const selected = permitted.filter(group => groupAliases(group.record).some(ref => requested.has(ref)));
    if (!selected.length) throw new AppError({ code: 'FORBIDDEN', message: 'This reading group is not assigned to your hierarchy' });
    return selected;
  }
  const callerFields = [
    'id', 'userId', 'email', 'fullName', 'displayName', 'name', 'role', 'segment', 'guide',
    'isBvAdmin', 'isPwAdmin', 'isBvSuperAdmin',
    'isBvSupervisor', 'isBvMentor', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
    'bvReportingFacilitatorId', 'bvGroupId', 'bvGroupName',
  ];
  const caller = await Users.findOne({ id: contextUser.id, fields: callerFields }) ||
    await Users.findOne({ filters: { userId: contextUser.userId || contextUser.id }, fields: callerFields }) ||
    await Users.findOne({ filters: { email: contextUser.email }, fields: callerFields });

  const callerAliases = new Set([
    contextUser.id, contextUser.userId, contextUser.email,
    caller?.id, caller?.userId, caller?.email,
  ].flatMap(refs));
  const reportingFields = [
    'id', 'userId', 'email', 'role', 'segment', 'isPrabhupadaWorldUser', 'guide',
    'isBvSupervisor', 'isBvMentor', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
    'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId',
  ];
  const allUsersResult = await readScopedUsers(contextUser, { fields: reportingFields, limit: 5000 });
  const allUsers = allUsersResult.records as UserRecord[];

  const parentAliases = new Set([
    contextUser.bvReportingFacilitatorId,
    (caller as UserRecord | undefined)?.bvReportingFacilitatorId,
  ].flatMap(refs));

  if (parentAliases.size > 0) {
    const known = new Set(allUsers.flatMap(user => bvUserAliases(user)));
    const rawParents = [contextUser.bvReportingFacilitatorId, (caller as UserRecord | undefined)?.bvReportingFacilitatorId]
      .flatMap(value => Array.isArray(value) ? value.flat(Infinity) : [value])
      .filter(Boolean)
      .map(value => String(value).trim())
      .filter(Boolean);
    const missing = [...new Set([...parentAliases, ...rawParents])].filter(alias => !known.has(alias) && !known.has(alias.toLowerCase()));
    for (const field of ['id', 'userId', 'email']) {
      for (let index = 0; index < missing.length; index += 30) {
        const chunk = missing.slice(index, index + 30);
        const { records } = await Users.findAll({
          filters: { [field]: { in: chunk } }, fields: reportingFields, limit: 30,
        });
        allUsers.push(...(records as UserRecord[]));
      }
    }
    for (const parent of allUsers) {
      if (bvUserAliases(parent).some(alias => parentAliases.has(alias))) {
        bvUserAliases(parent).forEach(alias => parentAliases.add(alias));
      }
    }
  }

  const role = roleValue(contextUser);
  const callerRole = roleValue(caller);
  const isAdmin = !!(
    contextUser.isBvAdmin || contextUser.isPwAdmin ||
    caller?.isBvAdmin || caller?.isPwAdmin ||
    role === 'ADMIN' || role === 'PW_ADMIN' ||
    callerRole === 'ADMIN' || callerRole === 'PW_ADMIN'
  );
  const isSupervisor = !!(
    contextUser.isBvSupervisor || contextUser.isBvMentor ||
    caller?.isBvSupervisor || caller?.isBvMentor ||
    role === 'SUPERVISOR' || role === 'BV_SUPERVISOR' ||
    callerRole === 'SUPERVISOR' || callerRole === 'BV_SUPERVISOR'
  );
  const isRgsf = !!(contextUser.isBvSubFacilitator || caller?.isBvSubFacilitator || role.includes('RGSF') || callerRole.includes('RGSF'));
  const isFacilitator = isRgsf || !!(
    contextUser.isBvFacilitator || contextUser.isBvsl ||
    caller?.isBvFacilitator || caller?.isBvsl ||
    ['RGF', 'BVSL', 'FACILITATOR', 'BV_FACILITATOR'].includes(role) ||
    ['RGF', 'BVSL', 'FACILITATOR', 'BV_FACILITATOR'].includes(callerRole)
  );
  // Personal sadhana shows the group stored on the profile or membership row.
  // Older groups also stored the facilitator's display name instead of an id.
  // Those links belong on an RGF/RGSF Groups tab even when bvslId is stale.
  const callerNameAliases = new Set(refs([
    contextUser.fullName, contextUser.displayName, contextUser.name,
    caller?.fullName, caller?.displayName, caller?.name,
  ]));
  const assignedGroupRefs = new Set(refs([
    contextUser.bvGroupId, contextUser.bvGroupName,
    caller?.bvGroupId, caller?.bvGroupName,
  ]));
  const memberGroupRefs = new Set<string>();
  if (isFacilitator) {
    const { records: memberships } = await BvGroupMembers.findAll({
      fields: ['user', 'userId', 'memberId', 'group', 'groupId'],
      limit: 5000,
    });
    for (const membership of memberships) {
      const memberRefs = refs([membership.user, membership.userId, membership.memberId]);
      if (!memberRefs.some(ref => callerAliases.has(ref))) continue;
      refs([membership.group, membership.groupId]).forEach(ref => memberGroupRefs.add(ref));
    }
  }

  // Resolve every identity alias for RGFs that report to this admin or
  // supervisor. Older data can store a Firestore id, public userId, or email.
  const reportingRgfAliases = new Set<string>();
  if (isAdmin || isSupervisor) {
    for (const user of allUsers) {
      const reportingAdminRefs = refs(user.bvReportingAdminId);
      const reportingSupervisorRefs = refs(user.bvReportingSupervisorId);
      const legacyGuideRefs = refs(user.guide);
      const userRole = roleValue(user);
      const isRgf = !!(user.isBvFacilitator || user.isBvsl || userRole === 'RGF' || userRole === 'BVSL' || userRole === 'FACILITATOR');
      if (!isRgf) continue;
      const explicitParentRefs = isAdmin ? reportingAdminRefs : reportingSupervisorRefs;
      const explicitlyReports = explicitParentRefs.some(ref => callerAliases.has(ref));
      const legacyReports = explicitParentRefs.length === 0 && legacyGuideRefs.some(ref => callerAliases.has(ref));
      if (explicitlyReports || legacyReports) {
        bvUserAliases(user).forEach(alias => reportingRgfAliases.add(alias));
      }
    }
  }

  const segmentByUserAlias = new Map<string, 'FOLK' | 'PW'>();
  for (const user of allUsers) {
    const segment = departmentValue(user.segment) || (user.isPrabhupadaWorldUser === true ? 'PW' : null);
    if (!segment) continue;
    bvUserAliases(user).forEach(alias => segmentByUserAlias.set(alias, segment));
  }

  const { records: allGroups } = await BvGroups.findAll({
    fields: ['id', 'groupId', 'groupName', 'description', 'segment', 'guide', 'isActive', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator', 'joinToken', 'meetingTime', 'preferredTimeSlot'],
    limit: 1000,
  });
  let groups = allGroups.filter(group => {
    if (group.isActive === false) return false;
    const leaderRefs = refs([group.bvslLeader, group.bvslId]);
    const facilitatorRefs = refs([group.bvslLeader, group.bvslId, group.bvslName]);
    const rgsfRefs = refs([group.subFacilitatorId, group.rgsfId, group.subFacilitator]);
    const groupIdentityRefs = refs([group.id, group.groupId, group.groupName]);
    const legacyNameMatch = isFacilitator && facilitatorRefs.some(ref => callerNameAliases.has(ref));
    const assignedToCaller = isFacilitator && groupIdentityRefs.some(ref =>
      assignedGroupRefs.has(ref) || memberGroupRefs.has(ref)
    );
    if (options.segment) {
      const explicitSegment = departmentValue(group.segment);
      const inferredSegments = leaderRefs.map(ref => segmentByUserAlias.get(ref)).filter(Boolean);
      const groupSegment = explicitSegment || inferredSegments[0] || '';
      if (groupSegment && groupSegment !== options.segment) return false;
    }
    if (isAdmin || isSupervisor) {
      const legacyGuideRefs = refs(group.guide);
      return leaderRefs.some(ref => reportingRgfAliases.has(ref)) ||
        leaderRefs.some(ref => callerAliases.has(ref)) ||
        legacyGuideRefs.some(ref => callerAliases.has(ref)) ||
        legacyNameMatch ||
        assignedToCaller;
    }
    if (isRgsf) {
      return leaderRefs.some(ref => callerAliases.has(ref)) ||
        rgsfRefs.some(ref => callerAliases.has(ref)) ||
        leaderRefs.some(ref => parentAliases.has(ref)) ||
        legacyNameMatch ||
        assignedToCaller;
    }
    return leaderRefs.some(ref => callerAliases.has(ref)) || legacyNameMatch || assignedToCaller;
  });

  if (options.groupId) {
    const requested = new Set(refs(options.groupId));
    groups = groups.filter(group => groupAliases(group).some(alias => requested.has(alias)));
    if (groups.length === 0) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This reading group is not assigned to your hierarchy' });
    }
  }

  return groups.map(group => ({
    id: String(group.id || ''),
    groupId: String(group.groupId || group.id || ''),
    groupName: String(group.groupName || 'Reading Group'),
    record: group,
  })).filter(group => !!group.id);
}

/** Resolve the authoritative Users records belonging to the caller's BV groups. */
export async function resolveBvGroupMemberUsers(
  contextUser: UserRecord,
  userFields: string[],
  options: BvGroupScopeOptions = {},
): Promise<UserRecord[]> {
  const groups = await resolveBvScopedGroups(contextUser, options);
  if (groups.length === 0) return [];

  const scopedGroupAliases = new Set(groups.flatMap(group => refs([group.id, group.groupId])));
  const { records: memberships } = await BvGroupMembers.findAll({
    fields: ['id', 'user', 'userId', 'memberId', 'group', 'groupId'],
    limit: 5000,
  });
  const memberAliases = new Set<string>();
  const groupRefsByMemberAlias = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const membershipGroupRefs = refs([membership.group, membership.groupId]);
    if (!membershipGroupRefs.some(ref => scopedGroupAliases.has(ref))) continue;
    const membershipMemberRefs = refs([membership.user, membership.userId, membership.memberId]);
    membershipMemberRefs.forEach(memberRef => {
      memberAliases.add(memberRef);
      const assignedGroups = groupRefsByMemberAlias.get(memberRef) || new Set<string>();
      membershipGroupRefs.forEach(groupRef => assignedGroups.add(groupRef));
      groupRefsByMemberAlias.set(memberRef, assignedGroups);
    });
  }
  if (memberAliases.size === 0) return [];

  // Membership is authoritative. Do not require one exact status spelling;
  // this keeps Sadhana reports consistent with the Group Members tab.
  const users = await resolveCanonicalUsersByAliases(memberAliases, userFields);
  const hierarchy = isHierarchyAdmin(contextUser) ? await getScopedHierarchyUserIds(contextUser) : null;
  const callerAliases = new Set(bvUserAliases(contextUser));
  // Facilitators can appear in a legacy group-membership record. A report
  // opened by an RGF/RGSF is a member report, so never surface the RGF or
  // RGSF as one of the people being monitored.
  const facilitatorAliases = new Set<string>();
  if (options.excludeCaller) {
    for (const group of groups) {
      bvGroupFacilitatorAliases(group.record).forEach(alias => facilitatorAliases.add(alias));
    }
  }
  return users
    .filter(user => isUserInHierarchy(user, hierarchy))
    .filter(user => !options.excludeCaller || !bvUserAliases(user).some(alias =>
      callerAliases.has(alias) || facilitatorAliases.has(alias)
    ))
    .map(user => {
      const scopedGroupIds = new Set<string>();
      bvUserAliases(user).forEach(alias => {
        groupRefsByMemberAlias.get(alias)?.forEach(groupRef => scopedGroupIds.add(groupRef));
      });
      return { ...user, __bvScopedGroupIds: [...scopedGroupIds] };
    });
}

/** Resolve canonical RGF/RGSF profiles attached to the caller's scoped groups. */
export async function resolveBvGroupFacilitatorUsers(
  contextUser: UserRecord,
  userFields: string[],
  options: BvGroupScopeOptions = {},
): Promise<UserRecord[]> {
  const groups = await resolveBvScopedGroups(contextUser, options);
  const facilitatorAliases = new Set<string>();
  for (const group of groups) {
    refs([
      group.record.bvslLeader,
      group.record.bvslId,
      group.record.subFacilitatorId,
      group.record.rgsfId,
      group.record.subFacilitator,
    ]).forEach(alias => facilitatorAliases.add(alias));
  }
  const users = await resolveCanonicalUsersByAliases(facilitatorAliases, userFields);
  const hierarchy = isHierarchyAdmin(contextUser) ? await getScopedHierarchyUserIds(contextUser) : null;
  return users.filter(user => isUserInHierarchy(user, hierarchy));
}
