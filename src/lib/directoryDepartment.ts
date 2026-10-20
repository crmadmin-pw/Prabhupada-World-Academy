/** Department checks for the member directory. Safe to import from the browser. */

const FOLK_LEADERSHIP_ROLES = new Set(['GUIDE', 'SUPERGUIDE']);
const PW_LEADERSHIP_ROLES = new Set([
  'ADMIN', 'ADMINISTRATOR', 'SUPERADMIN', 'SUPERADMINISTRATOR', 'PWADMIN', 'PWSUPERADMIN',
]);

export function normalizeDepartmentToken(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
}

/**
 * Department of a person or group. An explicit segment wins over stale flags.
 * Guide roles belong to FOLK. Admin and Super Admin roles belong to PW.
 * Records with neither a segment nor a leadership role stay unclassified so
 * legacy FOLK members are not relabeled as Prabhupada World.
 */
export function organizationalDepartment(user: any): 'PW' | 'FOLK' | null {
  if (!user || typeof user !== 'object') return null;
  const segment = normalizeDepartmentToken(user.segment ?? user.category);
  if (segment === 'FOLK') return 'FOLK';
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD') return 'PW';
  const role = normalizeDepartmentToken(user.role);
  if (FOLK_LEADERSHIP_ROLES.has(role)) return 'FOLK';
  if (user.isFolkUser === true || user.isFolkLead === true) return 'FOLK';
  if (
    user.isPwAdmin === true ||
    user.isPrabhupadaWorldMentor === true ||
    PW_LEADERSHIP_ROLES.has(role) ||
    user.isBvAdmin === true ||
    user.isBvSuperAdmin === true ||
    user.isPrabhupadaWorldUser === true
  ) return 'PW';
  return null;
}

/** A FOLK caller cannot receive records that belong to Prabhupada World. */
export function visibleToCallerDepartment<T>(caller: any, records: T[]): T[] {
  if (organizationalDepartment(caller) !== 'FOLK') return records;
  return records.filter(record => organizationalDepartment(record) !== 'PW');
}

/** Display names may be resolved only inside the caller's own department. */
export function labelVisibleToCaller(caller: any, record: any): boolean {
  const callerDepartment = organizationalDepartment(caller);
  const recordDepartment = organizationalDepartment(record);
  return !callerDepartment || !recordDepartment || callerDepartment === recordDepartment;
}

function identityRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identityRefs);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return identityRefs([record.id, record.userId, record.userDbId, record.guideId, record.email]);
  }
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || ['unassigned', 'none', 'na', 'n/a', 'null', 'undefined'].includes(text)) return [];
  return [text];
}

export function directoryGuideRefs(user: any): string[] {
  return identityRefs([
    user?.guide,
    user?.selectedGuideId,
    user?.guideId,
    user?.mentorId,
    user?.selectedGuideName,
    user?.guideName,
    user?._guideId,
    user?._guideName,
  ]);
}

/** Identities of FOLK guides present in a directory payload. */
export function folkGuideIdentityRefs(users: any[]): Set<string> {
  const refs = new Set<string>();
  for (const user of users) {
    const role = normalizeDepartmentToken(user?.role);
    if (role !== 'GUIDE' && role !== 'SUPERGUIDE') continue;
    for (const ref of identityRefs([
      user?.id, user?.userId, user?.userDbId, user?.guideId, user?.email, user?.fullName, user?.name,
    ])) refs.add(ref);
  }
  return refs;
}

/**
 * A Prabhupada World directory row is an explicit PW member who is not a FOLK
 * guide and is not assigned to one. A FOLK guide link wins over a stale PW flag.
 */
export function isPrabhupadaWorldDirectoryMember(user: any, folkGuideRefs?: ReadonlySet<string>): boolean {
  const segment = normalizeDepartmentToken(user?.segment);
  const role = normalizeDepartmentToken(user?.role);
  if (segment === 'FOLK') return false;
  if (user?.isFolkUser === true || user?.isFolkLead === true) return false;
  if (role === 'GUIDE' || role === 'SUPERGUIDE') return false;
  if (folkGuideRefs && directoryGuideRefs(user).some(ref => folkGuideRefs.has(ref))) return false;
  if (segment === 'PW' || segment === 'PRABHUPADAWORLD') return true;
  return user?.isPrabhupadaWorldUser === true;
}
