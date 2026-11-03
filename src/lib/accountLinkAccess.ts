import { normalizeDepartmentToken, organizationalDepartment } from './directoryDepartment';

export interface AccountLinkReviewer {
  capabilities?: readonly string[];
  role?: unknown;
  normalizedRole?: unknown;
  segment?: string | null;
  isBvAdmin?: boolean;
  isBvSuperAdmin?: boolean;
}

function hasSystemReviewAccess(user: AccountLinkReviewer): boolean {
  const role = String(user.normalizedRole || user.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  return !!(user.capabilities?.includes('*') || user.capabilities?.includes('system.admin') ||
    ['SUPER_ADMIN', 'ADMIN', 'PW_ADMIN'].includes(role) || user.isBvSuperAdmin === true);
}

/** Shared by the Approvals tab and its API handlers. */
export function canReviewAccountLinks(user: AccountLinkReviewer | null | undefined): boolean {
  return !!user && (hasSystemReviewAccess(user) ||
    (user.isBvAdmin === true && organizationalDepartment(user) === 'PW'));
}

export function isScopedPwAccountLinkReviewer(user: AccountLinkReviewer): boolean {
  return canReviewAccountLinks(user) && !hasSystemReviewAccess(user);
}

/** BV-admin flags grant PW member review without granting system administration
 * or the ability to bind another administrator to a new login. */
export function canReviewAccountLinkProfile(user: AccountLinkReviewer, profile: any): boolean {
  if (!canReviewAccountLinks(user) || !profile) return false;
  return !isScopedPwAccountLinkReviewer(user) ||
    (organizationalDepartment(profile) === 'PW' && !profile.isBvAdmin && !profile.isBvSuperAdmin && !profile.isPwAdmin &&
      !['ADMIN', 'ADMINISTRATOR', 'SUPERADMIN', 'SUPERADMINISTRATOR', 'PWADMIN', 'PWSUPERADMIN'].includes(normalizeDepartmentToken(profile.role)));
}
