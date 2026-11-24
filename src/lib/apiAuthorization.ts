import { organizationalDepartment } from './directoryDepartment';

export type ApiCapability =
  | '*'
  | 'system.admin'
  | 'account.links.review'
  | 'users.approve'
  | 'pw.approvals'
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
  pwSuperAdminAccess?: boolean;
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
  activeDepartment: 'FOLK' | 'PW' | null;
  baseDepartment: 'FOLK' | 'PW' | null;
  baseRole: string;
  pwSuperAdminAccess: boolean;
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
      'account.links.review',
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
    if (organizationalDepartment(dbUser) === 'PW') {
      capabilities.add('account.links.review');
      capabilities.add('pw.approvals');
    }
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

const PW_APPROVAL_ENDPOINTS = new Set(['getPendingApprovals', 'getGuideRequests', 'approveUser', 'rejectUser', 'approveAshrayUpgrade']);

/** Flag-based PW admins may use only the PW approval workflow. */
export function hasEndpointCapabilities(user: ApiUserContext | null, endpoint: string, required: ApiCapability | ApiCapability[] | undefined): boolean {
  return hasApiCapabilities(user, required) || (
    required === 'users.approve' && PW_APPROVAL_ENDPOINTS.has(endpoint) && hasApiCapabilities(user, 'pw.approvals')
  );
}

export function buildApiUserContext(
  identity: VerifiedApiIdentity,
  dbUser: ApiDatabaseUser | null,
  requestedDepartment?: string | null,
): ApiUserContext {
  const baseDepartment = organizationalDepartment(dbUser);
  const baseRole = dbUser?.role || 'UNREGISTERED';
  const pwSuperAdminAccess = !!(
    dbUser?.pwSuperAdminAccess === true &&
    normalizeApiStatus(dbUser?.status) === 'ACTIVE' &&
    baseDepartment === 'FOLK' &&
    normalizeApiRole(baseRole) === 'SUPER_GUIDE'
  );
  const usePwMode = pwSuperAdminAccess && String(requestedDepartment || '').toUpperCase() === 'PW';
  const effectiveUser: ApiDatabaseUser | null = dbUser && usePwMode ? {
    ...dbUser,
    role: 'SUPER_ADMIN',
    segment: 'PW',
    isBvAdmin: true,
    isBvSuperAdmin: true,
    isBvSupervisor: false,
    isBvMentor: false,
    isBvFacilitator: false,
    isBvSubFacilitator: false,
    isBvsl: false,
    isSadhanaMentor: false,
    isServiceAllocator: false,
    isCleanlinessManager: false,
    isFolkLead: false,
    isTripCoordinator: false,
  } : dbUser;
  const normalizedRole = normalizeApiRole(effectiveUser?.role);
  const status = effectiveUser?.status ? String(effectiveUser.status) : null;
  const isActive = normalizeApiStatus(status) === 'ACTIVE';
  const isAdminRole = normalizedRole === 'ADMIN' || normalizedRole === 'PW_ADMIN';
  const isSuperAdminRole = normalizedRole === 'SUPER_ADMIN';

  const nameVal = effectiveUser?.fullName || effectiveUser?.name || '';

  return {
    id: effectiveUser?.id || identity.uid,
    uid: identity.uid,
    userId: effectiveUser?.userId || effectiveUser?.id || identity.uid,
    email: identity.email.toLowerCase(),
    emailVerified: identity.emailVerified,
    role: effectiveUser?.role || 'UNREGISTERED',
    normalizedRole,
    status,
    segment: effectiveUser?.segment || null,
    fullName: nameVal,
    name: nameVal,
    isRegistered: !!(effectiveUser?.userId && effectiveUser?.status),
    isActive,
    isBvAdmin: isActive && (isAdminRole || isSuperAdminRole || effectiveUser?.isBvAdmin === true),
    isBvSuperAdmin: isActive && (isSuperAdminRole || effectiveUser?.isBvSuperAdmin === true),
    isBvSupervisor: isActive && (effectiveUser?.isBvSupervisor === true || effectiveUser?.isBvMentor === true),
    isBvMentor: isActive && (effectiveUser?.isBvMentor === true || effectiveUser?.isBvSupervisor === true),
    isBvFacilitator: isActive && effectiveUser?.isBvFacilitator === true,
    isBvSubFacilitator: isActive && effectiveUser?.isBvSubFacilitator === true,
    isBvsl: isActive && effectiveUser?.isBvsl === true,
    isSadhanaMentor: isActive && effectiveUser?.isSadhanaMentor === true,
    isServiceAllocator: isActive && effectiveUser?.isServiceAllocator === true,
    isCleanlinessManager: isActive && effectiveUser?.isCleanlinessManager === true,
    isFolkLead: isActive && effectiveUser?.isFolkLead === true,
    isTripCoordinator: isActive && effectiveUser?.isTripCoordinator === true,
    activeDepartment: organizationalDepartment(effectiveUser),
    baseDepartment,
    baseRole,
    pwSuperAdminAccess,
    capabilities: deriveApiCapabilities(effectiveUser),
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
