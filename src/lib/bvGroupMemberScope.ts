import { AppError, BvGroups, BvGroupMembers, Users } from '@/lib/backend-sdk';
import { listedReadingRoles } from '@/lib/bvGroupFacilitators';
import { getScopedHierarchyUserIds, isHierarchyAdmin, isPwDepartmentAdmin, isUserInHierarchy, hierarchyRefs, readScopedUsers } from './hierarchyUtils';

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
  /**
   * Supervisor dashboard. Groups this person only facilitates stay out.
   * An admin's saved selection replaces the older "every group of a reporting RGF" list.
   */
  supervisionOnly?: boolean;
  /** Admin lists keep deactivated groups visible. Reports stay on active groups. */
  includeInactive?: boolean;
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

function withVisibleName(user: UserRecord): UserRecord {
  const fullName = profileName(user);
  if (!fullName || fullName === String(user.fullName || '').trim()) return user;
  return { ...user, fullName };
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

export function isBvSupervisorUser(user: UserRecord | null | undefined): boolean {
  const role = roleValue(user);
  return !!(user?.isBvSupervisor || user?.isBvMentor ||
    role === 'SUPERVISOR' || role === 'BV_SUPERVISOR' || role === 'BV_MENTOR');
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
  options?: { includeInactive?: boolean },
): Promise<BvScopedGroup[]> {
  const { records: allGroups } = await BvGroups.findAll({
      fields: ['id', 'groupId', 'groupName', 'description', 'segment', 'guide', 'isActive', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator', 'supervisorId', 'supervisorUserId', 'supervisorName'],
      limit: 1000,
  });
  const requestedGroup = groupId ? new Set(refs(groupId)) : null;
  const listed = (group: UserRecord) => options?.includeInactive || group.isActive !== false;
  const needsLegacyDepartment = allGroups.some(group => listed(group) &&
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
    if (!listed(group)) return false;
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
 * Supervisors require an explicit assignment on the group. RGSFs require
 * explicit group assignments; their reporting RGF does not grant group access.
 */
export async function resolveBvScopedGroups(
  contextUser: UserRecord,
  options: BvGroupScopeOptions = {},
): Promise<BvScopedGroup[]> {
  // A Prabhupada World admin monitors every reading group in the department.
  // The supervisor dashboard still uses the groups assigned to that person.
  if (isPwDepartmentAdmin(contextUser) && options.supervisionOnly !== true && options.segment !== 'FOLK') {
    const groups = await resolveBvDepartmentGroups('PW', undefined, { includeInactive: options.includeInactive });
    if (!options.groupId) return groups;
    const requested = new Set(refs(options.groupId));
    const selected = groups.filter(group => groupAliases(group.record).some(ref => requested.has(ref)));
    if (!selected.length) throw new AppError({ code: 'FORBIDDEN', message: 'This reading group is not assigned to your hierarchy' });
    return selected;
  }
  if (isHierarchyAdmin(contextUser)) {
    const scope = await getScopedHierarchyUserIds(contextUser);
    const groups = options.segment
      ? await resolveBvDepartmentGroups(options.segment, undefined, { includeInactive: options.includeInactive })
      : (await BvGroups.findAll({ limit: 5000 })).records.filter(g => options.includeInactive || g.isActive !== false).map(record => ({
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
    'bvReportingFacilitatorId', 'bvGroupId', 'bvGroupName', 'bvSupervisedGroupIds',
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
    role === 'SUPERVISOR' || role === 'BV_SUPERVISOR' || role === 'BV_MENTOR' ||
    callerRole === 'SUPERVISOR' || callerRole === 'BV_SUPERVISOR' || callerRole === 'BV_MENTOR'
  );
  let isRgsf = !!(contextUser.isBvSubFacilitator || caller?.isBvSubFacilitator || role.includes('RGSF') || callerRole.includes('RGSF'));
  let isFacilitator = isRgsf || !!(
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
    fields: ['id', 'groupId', 'groupName', 'description', 'segment', 'guide', 'isActive', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator', 'supervisorId', 'supervisorUserId', 'joinToken', 'meetingTime', 'preferredTimeSlot'],
    limit: 1000,
  });
  const listed = listedReadingRoles(allGroups, {
    id: caller?.id || contextUser.id,
    userId: caller?.userId || contextUser.userId,
    email: caller?.email || contextUser.email,
    fullName: caller?.fullName || contextUser.fullName,
  });
  if (listed.listed) {
    isRgsf = listed.isSubFacilitator;
    isFacilitator = listed.isFacilitator || listed.isSubFacilitator;
  }
  let groups = allGroups.filter(group => {
    if (!options.includeInactive && group.isActive === false) return false;
    const leaderRefs = refs([group.bvslLeader, group.bvslId]);
    const facilitatorRefs = refs([group.bvslLeader, group.bvslId, group.bvslName]);
    const rgsfRefs = refs([group.subFacilitatorId, group.rgsfId, group.subFacilitator]);
    const groupIdentityRefs = refs([group.id, group.groupId, group.groupName]);
    const legacyNameMatch = isFacilitator && facilitatorRefs.some(ref => callerNameAliases.has(ref));
    const assignedToCaller = !listed.listed && isFacilitator && groupIdentityRefs.some(ref =>
      assignedGroupRefs.has(ref) || (assignedGroupRefs.size === 0 && memberGroupRefs.has(ref))
    );
    const requestedSegment = options.segment || departmentValue(caller?.segment || contextUser.segment);
    if (requestedSegment) {
      const explicitSegment = departmentValue(group.segment);
      const inferredSegments = leaderRefs.map(ref => segmentByUserAlias.get(ref)).filter(Boolean);
      const groupSegment = explicitSegment || inferredSegments[0] || '';
      if (groupSegment && groupSegment !== requestedSegment) return false;
    }
    if (isAdmin || isSupervisor) {
      const legacyGuideRefs = refs(group.guide);
      const supervisorRefs = refs([group.supervisorId, group.supervisorUserId]);
      const explicitMine = supervisorRefs.some(ref => callerAliases.has(ref));
      const ledByReportingRgf = leaderRefs.some(ref => reportingRgfAliases.has(ref));
      const ledByCaller = leaderRefs.some(ref => callerAliases.has(ref));
      const legacyGuide = legacyGuideRefs.some(ref => callerAliases.has(ref));
      const facilitates = ledByCaller || legacyNameMatch || assignedToCaller;
      if (isSupervisor && !isAdmin) {
        if (options.supervisionOnly) return explicitMine;
        // Personal RGF/RGSF access is separate from supervision.
        return explicitMine || facilitates || rgsfRefs.some(ref => callerAliases.has(ref));
      }
      return explicitMine || ledByReportingRgf || facilitates || legacyGuide;
    }
    if (isRgsf) {
      return leaderRefs.some(ref => callerAliases.has(ref)) ||
        rgsfRefs.some(ref => callerAliases.has(ref)) ||
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
  const rememberMember = (memberRef: string, groupRefsForMember: string[]) => {
    memberAliases.add(memberRef);
    const assignedGroups = groupRefsByMemberAlias.get(memberRef) || new Set<string>();
    groupRefsForMember.forEach(groupRef => assignedGroups.add(groupRef));
    groupRefsByMemberAlias.set(memberRef, assignedGroups);
  };
  for (const membership of memberships) {
    const membershipGroupRefs = refs([membership.group, membership.groupId]);
    if (!membershipGroupRefs.some(ref => scopedGroupAliases.has(ref))) continue;
    refs([membership.user, membership.userId, membership.memberId])
      .forEach(memberRef => rememberMember(memberRef, membershipGroupRefs));
  }
  // The group's own RGF and RGSF are members even when they have no membership row.
  const facilitatorAliases = new Set<string>();
  for (const group of groups) {
    const staffRefs = refs([
      group.record.bvslLeader,
      group.record.bvslId,
      group.record.subFacilitatorId,
      group.record.rgsfId,
      group.record.subFacilitator,
    ]);
    const groupRefsForStaff = refs([group.id, group.groupId]);
    staffRefs.forEach(alias => {
      facilitatorAliases.add(alias);
      rememberMember(alias, groupRefsForStaff);
    });
  }
  if (memberAliases.size === 0) return [];

  // Membership is authoritative. Do not require one exact status spelling;
  // this keeps Sadhana reports consistent with the Group Members tab.
  const users = await resolveCanonicalUsersByAliases(memberAliases, userFields);
  const hierarchy = isHierarchyAdmin(contextUser) && !isPwDepartmentAdmin(contextUser)
    ? await getScopedHierarchyUserIds(contextUser)
    : null;
  const callerAliases = new Set(bvUserAliases(contextUser));
  // A report can hide the caller, but the group's own RGF and RGSF stay in
  // the member list and in the headcount.
  const visibleUsers = users
    .filter(user => isUserInHierarchy(user, hierarchy))
    .filter(user => !options.excludeCaller || !bvUserAliases(user).some(alias => callerAliases.has(alias))
      || bvUserAliases(user).some(alias => facilitatorAliases.has(alias)));
  const claimedAliases = new Set<string>([
    ...users.flatMap(user => bvUserAliases(user)),
    ...(options.excludeCaller ? [...callerAliases, ...facilitatorAliases] : []),
  ]);
  // A group card counts every membership. The report has to count it too,
  // even when the member's Users document was removed.
  const unresolvedMembers = new Map<string, UserRecord>();
  for (const membership of memberships) {
    const membershipGroupRefs = refs([membership.group, membership.groupId]);
    if (!membershipGroupRefs.some(ref => scopedGroupAliases.has(ref))) continue;
    const memberRefs = refs([membership.user, membership.userId, membership.memberId]);
    if (memberRefs.length === 0 || memberRefs.some(ref => claimedAliases.has(ref))) continue;
    const existing = [...unresolvedMembers.values()].find(member =>
      bvUserAliases(member).some(alias => memberRefs.includes(alias))
    );
    const memberId = String(membership.user || membership.userId || membership.memberId);
    const member = existing || {
      id: memberId,
      userId: String(membership.userId || membership.memberId || membership.user || memberId),
      uid: membership.user ? String(membership.user) : undefined,
      fullName: String(membership.fullName || membership.memberName || membership.name || '').trim() || 'Devotee',
      __bvScopedGroupIds: [] as string[],
    };
    const scopedGroupIds = new Set<string>(member.__bvScopedGroupIds as string[]);
    membershipGroupRefs.forEach(groupRef => scopedGroupIds.add(groupRef));
    member.__bvScopedGroupIds = [...scopedGroupIds];
    unresolvedMembers.set(String(member.id), member);
    memberRefs.forEach(ref => claimedAliases.add(ref));
  }
  return [
    ...visibleUsers.map(user => {
      const scopedGroupIds = new Set<string>();
      bvUserAliases(user).forEach(alias => {
        groupRefsByMemberAlias.get(alias)?.forEach(groupRef => scopedGroupIds.add(groupRef));
      });
      return withVisibleName({ ...user, __bvScopedGroupIds: [...scopedGroupIds] });
    }),
    ...[...unresolvedMembers.values()].map(withVisibleName),
  ];
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
  const hierarchy = isHierarchyAdmin(contextUser) && !isPwDepartmentAdmin(contextUser)
    ? await getScopedHierarchyUserIds(contextUser)
    : null;
  return users.filter(user => isUserInHierarchy(user, hierarchy));
}
