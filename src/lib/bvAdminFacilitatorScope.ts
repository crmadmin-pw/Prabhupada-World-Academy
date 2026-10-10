import { resolveHierarchyScope, isUserInHierarchy, readScopedUsers } from './hierarchyUtils';

const SCOPE_FIELDS = [
  'id', 'userId', 'email', 'status', 'segment', 'isPrabhupadaWorldUser', 'role', 'guide',
  'isBvAdmin', 'isBvSuperAdmin', 'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'isBvSupervisor', 'isBvMentor', 'bvReportingAdminId', 'bvSupervisorGuideId',
  'bvReportingSupervisorId', 'bvReportingFacilitatorId',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

const IDENTITY_FIELDS = [
  'id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
  'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value == null) return [];
  return String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function aliases(user: any): string[] {
  return [...new Set(IDENTITY_FIELDS.flatMap(field => values(user?.[field])))];
}

function role(user: any): string {
  return String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function isSuperAdmin(user: any): boolean {
  const normalizedRole = role(user);
  return !!(user?.isBvSuperAdmin || normalizedRole === 'SUPER_ADMIN' || normalizedRole === 'SUPER_GUIDE');
}

function isAdmin(user: any): boolean {
  const normalizedRole = role(user);
  const normalizedSegment = String(user?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const isFolkGuide = normalizedRole === 'GUIDE' && normalizedSegment === 'FOLK';
  return !!(user?.isBvAdmin || user?.isPwAdmin || isSuperAdmin(user) || isFolkGuide || normalizedRole === 'ADMIN' || normalizedRole === 'PW_ADMIN');
}

function isRgf(user: any): boolean {
  const normalizedRole = role(user);
  return !!(user?.isBvFacilitator || user?.isBvsl || ['RGF', 'BVSL', 'FACILITATOR', 'BV_FACILITATOR'].includes(normalizedRole));
}

function isRgsf(user: any): boolean {
  const normalizedRole = role(user);
  return !!(user?.isBvSubFacilitator || ['RGSF', 'SUB_FACILITATOR', 'BV_SUB_FACILITATOR'].includes(normalizedRole));
}

function belongsToSegment(user: any, segment?: 'PW' | 'FOLK'): boolean {
  if (!segment) return true;
  const normalized = String(user?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const resolved = normalized === 'PW' || normalized === 'PRABHUPADAWORLD' || user?.isPrabhupadaWorldUser === true
    ? 'PW'
    : normalized === 'FOLK' ? 'FOLK' : '';
  return resolved === segment;
}

export function filterBvAdminFacilitators(
  allUsers: any[],
  contextUser: any,
  targetAdminId: string | undefined,
  segment?: 'PW' | 'FOLK',
): any[] {
  const activeUsers = allUsers.filter(user => user?.status === 'Active' && belongsToSegment(user, segment));
  const facilitators = activeUsers.filter(user => (isRgf(user) || isRgsf(user)) && !isAdmin(user));

  const callerIsSuperAdmin = isSuperAdmin(contextUser);
  if (!callerIsSuperAdmin && !isAdmin(contextUser)) return [];
  const requestedAll = !targetAdminId || targetAdminId.toUpperCase() === 'ALL';
  if (callerIsSuperAdmin && requestedAll) return facilitators;

  // A regular Admin can never expand this report by sending another Admin's ID.
  const requestedKeys = new Set(values(callerIsSuperAdmin ? targetAdminId : undefined));
  const callerKeys = new Set(aliases(contextUser));
  const targetRecord = callerIsSuperAdmin
    ? activeUsers.find(user => aliases(user).some(key => requestedKeys.has(key)))
    : activeUsers.find(user => aliases(user).some(key => callerKeys.has(key)));
  const adminKeys = new Set(targetRecord
    ? aliases(targetRecord)
    : callerIsSuperAdmin ? [...requestedKeys] : [...callerKeys]);
  if (adminKeys.size === 0) return [];

  const scope = resolveHierarchyScope({
    ...(targetRecord || (callerIsSuperAdmin ? { id: targetAdminId } : contextUser)),
    role: 'ADMIN', isBvAdmin: true, isBvSuperAdmin: false,
  }, activeUsers);
  return facilitators.filter(user => isUserInHierarchy(user, scope));
}

export async function resolveBvAdminFacilitators(
  contextUser: any,
  targetAdminId: string | undefined,
  requestedFields: string[],
  segment?: 'PW' | 'FOLK',
): Promise<any[]> {
  const fields = [...new Set([...requestedFields, ...SCOPE_FIELDS])];
  const { records } = await readScopedUsers(contextUser, { fields, limit: 2000 });
  return filterBvAdminFacilitators(records, contextUser, targetAdminId, segment);
}
