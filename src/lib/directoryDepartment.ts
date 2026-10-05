/** Department checks for the member directory. Safe to import from the browser. */

export function normalizeDepartmentToken(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s_-]+/g, '');
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
