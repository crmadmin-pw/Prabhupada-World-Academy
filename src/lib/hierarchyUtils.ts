import { Users, Guides, FolkResidencies, BvGroups, BvGroupMembers } from '@/lib/backend-sdk';

export const HIERARCHY_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid',
  'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

export function hierarchyRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(hierarchyRefs);
  return value == null ? [] : String(value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

export function hierarchyAliases(user: any): string[] {
  return HIERARCHY_IDENTITY_FIELDS.flatMap(field => hierarchyRefs(user?.[field]));
}

export function isHierarchySuperAdmin(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return !!user && (user.isBvSuperAdmin === true || ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(role));
}

export function isHierarchyAdmin(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return !!user && (isHierarchySuperAdmin(user) || user.isBvAdmin === true || user.isPwAdmin === true ||
    ['ADMIN', 'PW_ADMIN', 'GUIDE'].includes(role));
}

/** A Prabhupada World admin reads the full member directory, the same as a super admin. */
export function isPwDepartmentAdmin(user: any): boolean {
  if (!user) return false;
  const role = String(user.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const segment = String(user.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const explicitPwAdmin = user.isPwAdmin === true || role === 'PW_ADMIN';
  const inPwDepartment = explicitPwAdmin || (
    segment !== 'FOLK' && (
      user.isPrabhupadaWorldUser === true ||
      segment === 'PW' ||
      segment === 'PRABHUPADAWORLD'
    )
  );
  const isAdmin = explicitPwAdmin || user.isBvAdmin === true || role === 'ADMIN' || role === 'ADMINISTRATOR';
  return inPwDepartment && isAdmin;
}

export function isUserInHierarchy(user: any, scope: Set<string> | null): boolean {
  return scope === null || hierarchyAliases(user).some(alias => scope.has(alias));
}

function department(user: any): string {
  const segment = String(user?.segment || '').replace(/[\s_-]/g, '').toUpperCase();
  return user?.isPrabhupadaWorldUser || ['PW', 'PRABHUPADAWORLD'].includes(segment) ? 'PW' : segment;
}

/** Pure resolver. Only explicit reporting links and active memberships grant access.
 * Missing links never mean "all admins". Names are not user identity aliases.
 */
export function resolveHierarchyScope(caller: any, users: any[], groups: any[] = [], memberships: any[] = [], guides: any[] = [], residencies: any[] = []): Set<string> | null {
  if (!caller) return new Set();
  if (isHierarchySuperAdmin(caller)) return null;
  const callerKeys = new Set(hierarchyAliases(caller));
  const stored = users.find(user => isUserInHierarchy(user, callerKeys));
  hierarchyAliases(stored).forEach(key => callerKeys.add(key));
  const callerDepartment = department(caller) || department(stored);
  const eligible = (user: any) => !callerDepartment || !department(user) || department(user) === callerDepartment;
  const scope = new Set(callerKeys);
  const add = (user: any) => hierarchyAliases(user).forEach(key => scope.add(key));
  const expandGuideAliases = () => {
    for (const guide of guides) {
      if (isUserInHierarchy(guide, scope)) {
        hierarchyAliases(guide).forEach(key => scope.add(key));
        hierarchyRefs(guide.guideId).forEach(key => scope.add(key));
      }
    }
  };
  expandGuideAliases();
  const admin = isHierarchyAdmin(caller);
  const role = String(caller.role || '').toUpperCase().replace(/[\s-]/g, '_');
  const supervisor = caller.isBvSupervisor || caller.isBvMentor || ['SUPERVISOR', 'BV_SUPERVISOR'].includes(role);
  const rgf = caller.isBvFacilitator || caller.isBvsl || ['RGF', 'BVSL', 'FACILITATOR'].includes(role);
  const rgsf = caller.isBvSubFacilitator || role === 'RGSF';
  const mentor = caller.isSadhanaMentor || role === 'SADHANA_MENTOR';

  // Explicit admin ownership takes precedence over stale legacy guide links.
  const foreignAdmin = (user: any) => {
    const refs = hierarchyRefs(user.bvReportingAdminId || user.bvSupervisorGuideId);
    return admin && refs.length > 0 && !refs.some(ref => scope.has(ref));
  };
  if (admin || supervisor || rgf) {
    let previousSize = -1;
    while (previousSize !== scope.size) {
      previousSize = scope.size;
      expandGuideAliases();
      for (const user of users) {
        if (!eligible(user) || foreignAdmin(user)) continue;
        // An explicit immediate parent wins over legacy guide/registration fields.
        const parents = hierarchyRefs(user.bvReportingFacilitatorId || user.bvReportingSupervisorId ||
          user.bvReportingAdminId || user.bvSupervisorGuideId || user.guide || user.selectedGuideId);
        if (parents.some(ref => scope.has(ref))) add(user);
      }
    }
  }
  // Legacy FOLK residents may only have a center assignment. That is an
  // ownership link only for a guide managing the center, and never overrides
  // an explicit assignment to a different guide/admin.
  if (admin && callerDepartment === 'FOLK') {
    const centerKeys = new Set<string>();
    for (const owner of [...guides, ...users]) if (isUserInHierarchy(owner, scope)) {
      hierarchyRefs(owner.folkResidencies).forEach(ref => centerKeys.add(ref));
    }
    for (const residency of residencies) {
      const refs = hierarchyRefs([residency.id, residency.residencyId, residency.residencyName]);
      if (refs.some(ref => centerKeys.has(ref)) || hierarchyRefs([residency.guideIds, residency.guides]).some(ref => scope.has(ref))) {
        refs.forEach(ref => centerKeys.add(ref));
      }
    }
    for (const user of users) {
      if (!eligible(user) || hierarchyRefs([user.guide, user.selectedGuideId, user.bvReportingAdminId, user.bvReportingSupervisorId, user.bvReportingFacilitatorId]).length) continue;
      if (hierarchyRefs(user.residency).some(ref => centerKeys.has(ref))) add(user);
    }
  }
  const groupOwners = new Set(scope);
  if (rgsf) {
    const parentRefs = new Set(hierarchyRefs(caller.bvReportingFacilitatorId || stored?.bvReportingFacilitatorId));
    for (const user of users) if (eligible(user) && isUserInHierarchy(user, parentRefs)) {
      hierarchyAliases(user).forEach(key => groupOwners.add(key));
    }
    parentRefs.forEach(key => groupOwners.add(key));
  }
  const groupIds = new Set<string>();
  for (const group of groups) {
    if (group.isActive === false || !eligible(group)) continue;
    const owners = hierarchyRefs([group.bvslId, group.bvslLeader, group.subFacilitatorId, group.rgsfId, group.subFacilitator]);
    const guides = hierarchyRefs(group.guide);
    if (admin && guides.length && !guides.some(ref => scope.has(ref))) continue;
    if (owners.some(ref => groupOwners.has(ref)) || (!(rgsf && !admin && !supervisor && !rgf) && guides.some(ref => scope.has(ref)))) {
      hierarchyRefs([group.id, group.groupId]).forEach(key => groupIds.add(key));
    }
  }
  const memberKeys = new Set<string>();
  for (const member of memberships) {
    if (member.isActive === false || ['inactive', 'removed', 'left'].includes(String(member.status || '').toLowerCase())) continue;
    if (hierarchyRefs([member.group, member.groupId]).some(ref => groupIds.has(ref))) {
      hierarchyRefs([member.user, member.userId, member.memberId]).forEach(key => memberKeys.add(key));
    }
  }
  // Resolve aliases through Users, not membership document IDs.
  for (const user of users) if (eligible(user) && !foreignAdmin(user) && isUserInHierarchy(user, memberKeys)) add(user);
  if (mentor) {
    const folkGuide = new Set(hierarchyRefs(stored?.guide || caller.guide));
    for (const user of users) {
      if (!eligible(user)) continue;
      const assigned = hierarchyRefs(user.sadhanaMentor).some(ref => callerKeys.has(ref));
      const folkAssigned = callerDepartment !== 'PW' && hierarchyRefs(user.guide).some(ref => folkGuide.has(ref));
      if (assigned || folkAssigned) add(user);
    }
  }
  return scope;
}

async function readAll(table: any, fields: string[]): Promise<any[]> {
  const records: any[] = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await table.findAll({ fields, limit: 2000, offset });
    records.push(...page.records);
    if (!page.hasMore) return records;
  }
}

/** Never fail open: a failed authorization lookup must fail the request. */
export async function getScopedHierarchyUserIds(contextUser: any): Promise<Set<string> | null> {
  if (!contextUser) return new Set();
  if (isHierarchySuperAdmin(contextUser)) return null;
  const [users, groups, memberships, guides, residencies] = await Promise.all([
    readAll(Users, [...HIERARCHY_IDENTITY_FIELDS, 'role', 'guide', 'selectedGuideId', 'segment', 'isPrabhupadaWorldUser',
      'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId', 'bvSupervisorGuideId', 'sadhanaMentor', 'folkResidencies', 'residency']),
    readAll(BvGroups, ['id', 'groupId', 'guide', 'segment', 'isActive', 'bvslId', 'bvslLeader', 'subFacilitatorId', 'rgsfId', 'subFacilitator']),
    readAll(BvGroupMembers, ['id', 'user', 'userId', 'memberId', 'group', 'groupId', 'isActive', 'status']),
    readAll(Guides, ['id', 'guideId', 'email', 'userId', 'folkResidencies']),
    department(contextUser) === 'FOLK' ? readAll(FolkResidencies, ['id', 'residencyId', 'residencyName', 'guideIds', 'guides']) : Promise.resolve([]),
  ]);
  return resolveHierarchyScope(contextUser, users, groups, memberships, guides, residencies);
}

/** A selected guide narrows super-admin reports using the same hierarchy,
 * including aliases and indirect members. Ordinary callers cannot widen it. */
export async function getDashboardHierarchyScope(contextUser: any, guideId?: string): Promise<Set<string> | null> {
  if (!isHierarchySuperAdmin(contextUser) || !guideId || guideId.toUpperCase() === 'ALL') {
    return getScopedHierarchyUserIds(contextUser);
  }
  const requested = new Set(hierarchyRefs(guideId));
  const [users, guides] = await Promise.all([
    readAll(Users, [...HIERARCHY_IDENTITY_FIELDS, 'segment', 'isPrabhupadaWorldUser', 'folkResidencies']),
    readAll(Guides, ['id', 'guideId', 'email', 'folkResidencies']),
  ]);
  const guide = guides.find(row => hierarchyRefs([row.id, row.guideId, row.email]).some(ref => requested.has(ref)));
  const target = users.find(row => isUserInHierarchy(row, requested) || (guide?.email && hierarchyRefs(row.email).includes(String(guide.email).toLowerCase())));
  if (!target && !guide) return new Set();
  return getScopedHierarchyUserIds({ ...(target || { ...guide, segment: 'FOLK' }), role: 'ADMIN', isBvAdmin: true, isBvSuperAdmin: false });
}
