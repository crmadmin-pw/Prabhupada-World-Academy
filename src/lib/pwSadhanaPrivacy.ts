import { getUserDepartment, isManagementProfile, normalizeProfileRole } from './userDashboardRoutes';

/** Include these fields whenever projecting a person for a Sadhana read. */
export const PW_SADHANA_PRIVACY_FIELDS = [
  'segment', 'isPrabhupadaWorldUser', 'isFolkUser', 'role', 'isBvAdmin', 'isPwAdmin', 'isBvSuperAdmin',
];

export function isPwSuperAdmin(user: any): boolean {
  return !!user && getUserDepartment(user) === 'PW' &&
    (user.isBvSuperAdmin === true || normalizeProfileRole(user.role) === 'SUPER_ADMIN');
}

export function isPwSadhanaAdmin(user: any): boolean {
  return !!user && getUserDepartment(user) === 'PW' && !isPwSuperAdmin(user) &&
    (user.isBvAdmin === true || user.isPwAdmin === true ||
      ['ADMIN', 'ADMINISTRATOR', 'PW_ADMIN'].includes(normalizeProfileRole(user.role)));
}

function identityRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identityRefs);
  return value == null ? [] : [String(value).trim().toLowerCase()].filter(Boolean);
}

function aliases(user: any): string[] {
  return ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId',
    'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id']
    .flatMap(field => identityRefs(user?.[field]));
}

/** An admin can read their own history. Only PW super admins can read it for oversight.
 * This supplements existing hierarchy authorization; it never grants member access. */
export function canViewPwSadhana(actor: any, subject: any, includeSelf = true): boolean {
  if (isPwSuperAdmin(subject)) return false;
  if (!isPwSadhanaAdmin(subject)) return true;
  if (isPwSuperAdmin(actor)) return true;
  const actorIds = new Set(aliases(actor));
  return includeSelf && aliases(subject).some(id => actorIds.has(id));
}

export function canFillPersonalSadhana(user: any): boolean {
  if (!user) return false;
  if (getUserDepartment(user) === 'PW') return !isPwSuperAdmin(user);
  return !isManagementProfile(user) && normalizeProfileRole(user.role) !== 'SUPER_GUIDE';
}
