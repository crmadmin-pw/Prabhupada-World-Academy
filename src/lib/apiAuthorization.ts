export type ApiCapability =
  | '*'
  | 'system.admin'
  | 'users.approve'
  | 'users.assigned.read'
  | 'users.bulk.manage'
  | 'roles.assign'
  | 'sadhana.mentor.assign'
  | 'sadhana.reports'
  | 'bv.manage'
  | 'bv.roles.assign'
  | 'attendance.manage'
  | 'services.manage'
  | 'cleanliness.manage'
  | 'meetings.manage'
  | 'notifications.send'
  | 'integrations.manage';

export interface VerifiedApiIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  authTime?: number | null;
}

export interface ApiDatabaseUser {
  id?: string;
  userId?: string;
  email?: string;
  role?: string;
  status?: string;
  segment?: string;
  fullName?: string;
  name?: string;
  firebaseUid?: string;
  authLinkedAt?: string;
  isBvAdmin?: boolean;
  isBvSuperAdmin?: boolean;
  isBvSupervisor?: boolean;
  isBvMentor?: boolean;
  isBvFacilitator?: boolean;
  isBvSubFacilitator?: boolean;
  isBvsl?: boolean;
  isSadhanaMentor?: boolean;
  isServiceAllocator?: boolean;
  isCleanlinessManager?: boolean;
  isFolkLead?: boolean;
  isTripCoordinator?: boolean;
}

export interface ApiUserContext {
  id: string;
  uid: string;
  userId: string;
  email: string;
  emailVerified: boolean;
  role: string;
  normalizedRole: string;
  status: string | null;
  segment: string | null;
  fullName?: string;
  name?: string;
  isRegistered: boolean;
  isActive: boolean;
  isBvAdmin: boolean;
  isBvSuperAdmin: boolean;
  isBvSupervisor: boolean;
  isBvMentor: boolean;
  isBvFacilitator: boolean;
  isBvSubFacilitator: boolean;
  isBvsl: boolean;
  isSadhanaMentor: boolean;
  isServiceAllocator: boolean;
  isCleanlinessManager: boolean;
  isFolkLead: boolean;
  isTripCoordinator: boolean;
  capabilities: ApiCapability[];
  authTime: number | null;
}

export function normalizeApiRole(value: unknown): string {
  return String(value || 'UNREGISTERED')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

export function normalizeApiStatus(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function addCapabilities(target: Set<ApiCapability>, capabilities: ApiCapability[]) {
  for (const capability of capabilities) target.add(capability);
}

export function deriveApiCapabilities(dbUser: ApiDatabaseUser | null): ApiCapability[] {
  if (!dbUser || normalizeApiStatus(dbUser.status) !== 'ACTIVE') return [];

  const capabilities = new Set<ApiCapability>();
  const role = normalizeApiRole(dbUser.role);
  const isFolk = String(dbUser.segment || '').trim().toUpperCase() === 'FOLK';

  if (role === 'SUPER_ADMIN' || dbUser.isBvSuperAdmin === true) {
    return ['*'];
  }

  if (role === 'ADMIN' || role === 'PW_ADMIN') {
    addCapabilities(capabilities, [
      'system.admin',
      'users.approve',
      'users.assigned.read',
      'roles.assign',
      'sadhana.mentor.assign',
      'sadhana.reports',
      'bv.manage',
      'bv.roles.assign',
      'attendance.manage',
      'services.manage',
      'cleanliness.manage',
      'notifications.send',
      'integrations.manage',
    ]);
    if (!isFolk) capabilities.add('meetings.manage');
  }

  if (role === 'SUPER_GUIDE') {
    addCapabilities(capabilities, [
      'users.approve',
      'users.assigned.read',
      'users.bulk.manage',
      'roles.assign',
      'sadhana.mentor.assign',
      'sadhana.reports',
      'bv.manage',
      'bv.roles.assign',
      'attendance.manage',
      'services.manage',
      'cleanliness.manage',
      'notifications.send',
      'integrations.manage',
    ]);
    if (!isFolk) capabilities.add('meetings.manage');
  }

  if (role === 'GUIDE') {
    addCapabilities(capabilities, [
      'users.approve',
      'users.assigned.read',
      'users.bulk.manage',
      'sadhana.mentor.assign',
      'sadhana.reports',
      'bv.manage',
      'bv.roles.assign',
      'attendance.manage',
      'notifications.send',
    ]);
  }

  if (dbUser.isBvAdmin === true) {
    addCapabilities(capabilities, ['bv.manage', 'bv.roles.assign', 'attendance.manage', 'notifications.send', 'integrations.manage']);
  }
  if (dbUser.isBvSupervisor === true || dbUser.isBvMentor === true) {
    addCapabilities(capabilities, ['users.assigned.read', 'sadhana.reports', 'bv.manage']);
    if (!isFolk) capabilities.add('meetings.manage');
  }
  if (dbUser.isBvFacilitator === true || dbUser.isBvsl === true) {
    addCapabilities(capabilities, ['users.assigned.read', 'sadhana.reports', 'bv.manage']);
    if (!isFolk) capabilities.add('meetings.manage');
  }
  // RGSFs (sub-facilitators) use the same scoped Sadhana/report APIs as
  // facilitators, but do not receive facilitator-only meeting permissions.
  // Endpoint-level scoping still limits them to their assigned groups.
  if (dbUser.isBvSubFacilitator === true || role === 'RGSF') {
    addCapabilities(capabilities, ['users.assigned.read', 'sadhana.reports', 'bv.manage']);
  }
  if (dbUser.isSadhanaMentor === true) {
    addCapabilities(capabilities, ['users.assigned.read', 'sadhana.reports']);
    if (!isFolk) capabilities.add('meetings.manage');
  }
  if (dbUser.isServiceAllocator === true) capabilities.add('services.manage');
  if (dbUser.isCleanlinessManager === true) capabilities.add('cleanliness.manage');

  return [...capabilities];
}

export function buildApiUserContext(
  identity: VerifiedApiIdentity,
  dbUser: ApiDatabaseUser | null,
): ApiUserContext {
  const normalizedRole = normalizeApiRole(dbUser?.role);
  const status = dbUser?.status ? String(dbUser.status) : null;
  const isActive = normalizeApiStatus(status) === 'ACTIVE';
  const isAdminRole = normalizedRole === 'ADMIN' || normalizedRole === 'PW_ADMIN';
  const isSuperAdminRole = normalizedRole === 'SUPER_ADMIN';

  const nameVal = dbUser?.fullName || dbUser?.name || '';

  return {
    id: dbUser?.id || identity.uid,
    uid: identity.uid,
    userId: dbUser?.userId || dbUser?.id || identity.uid,
    email: identity.email.toLowerCase(),
    emailVerified: identity.emailVerified,
    role: dbUser?.role || 'UNREGISTERED',
    normalizedRole,
    status,
    segment: dbUser?.segment || null,
    fullName: nameVal,
    name: nameVal,
    isRegistered: !!(dbUser?.userId && dbUser?.status),
    isActive,
    isBvAdmin: isActive && (isAdminRole || isSuperAdminRole || dbUser?.isBvAdmin === true),
    isBvSuperAdmin: isActive && (isSuperAdminRole || dbUser?.isBvSuperAdmin === true),
    isBvSupervisor: isActive && (dbUser?.isBvSupervisor === true || dbUser?.isBvMentor === true),
    isBvMentor: isActive && (dbUser?.isBvMentor === true || dbUser?.isBvSupervisor === true),
    isBvFacilitator: isActive && dbUser?.isBvFacilitator === true,
    isBvSubFacilitator: isActive && dbUser?.isBvSubFacilitator === true,
    isBvsl: isActive && dbUser?.isBvsl === true,
    isSadhanaMentor: isActive && dbUser?.isSadhanaMentor === true,
    isServiceAllocator: isActive && dbUser?.isServiceAllocator === true,
    isCleanlinessManager: isActive && dbUser?.isCleanlinessManager === true,
    isFolkLead: isActive && dbUser?.isFolkLead === true,
    isTripCoordinator: isActive && dbUser?.isTripCoordinator === true,
    capabilities: deriveApiCapabilities(dbUser),
    authTime: identity.authTime ?? null,
  };
}

export function hasApiCapabilities(
  user: ApiUserContext | null,
  required: ApiCapability | ApiCapability[] | undefined,
): boolean {
  if (!required) return true;
  if (!user?.isActive) return false;
  if (user.capabilities.includes('*')) return true;

  const requiredList = Array.isArray(required) ? required : [required];
  return requiredList.every(capability => user.capabilities.includes(capability));
}
