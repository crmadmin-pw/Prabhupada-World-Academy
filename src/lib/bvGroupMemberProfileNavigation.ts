type BvProfileViewer = {
  role?: string | null;
  isBvsl?: boolean;
  isBvFacilitator?: boolean;
  isSadhanaMentor?: boolean;
  isBvMentor?: boolean;
  isBvSupervisor?: boolean;
  isBvSubFacilitator?: boolean;
  isBvAdmin?: boolean;
  isBvSuperAdmin?: boolean;
};

const PROFILE_VIEWER_ROLES = new Set([
  'GUIDE',
  'SUPER_GUIDE',
  'ADMIN',
  'PW_ADMIN',
  'SUPER_ADMIN',
]);

export function isBvGroupProfileAdministrator(profile?: BvProfileViewer | null): boolean {
  if (!profile) return false;
  const role = String(profile.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return PROFILE_VIEWER_ROLES.has(role)
    || profile.isBvAdmin === true
    || profile.isBvSuperAdmin === true;
}

/** Whether this dashboard role may open a group member's managed profile. */
export function canOpenBvGroupMemberProfile(profile?: BvProfileViewer | null): boolean {
  if (!profile) return false;
  return isBvGroupProfileAdministrator(profile)
    || profile.isBvsl === true
    || profile.isBvFacilitator === true
    || profile.isSadhanaMentor === true
    || profile.isBvMentor === true
    || profile.isBvSupervisor === true
    || profile.isBvSubFacilitator === true;
}

export function getBvGroupMemberProfileBasePath(profile?: BvProfileViewer | null): '/guide/users' | '/rgsf/users' {
  const role = String(profile?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const isRgf = profile?.isBvsl === true || profile?.isBvFacilitator === true || ['BVSL', 'RGF', 'FACILITATOR'].includes(role);
  const isRgsf = profile?.isBvSubFacilitator === true || role === 'RGSF' || role === 'SUB_FACILITATOR';
  return isRgsf && !isRgf ? '/rgsf/users' : '/guide/users';
}

const MANAGED_DETAIL_PATH = /^\/(?:guide\/users|rgsf\/users|bvsl\/groups)\/[^/?#]+$/;

/** Group and member profile pages. Returning to one of these from Back loops. */
export function isManagedDetailPath(path: string): boolean {
  return MANAGED_DETAIL_PATH.test(path.split(/[?#]/)[0]);
}

/** A same-app list or dashboard path. Detail pages are not safe Back targets. */
export function safeReturnPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return undefined;
  if (isManagedDetailPath(path)) return undefined;
  return path;
}

export function detailBackTarget(state: unknown, fallback: string): string {
  const record = state && typeof state === 'object' ? state as { from?: unknown; origin?: unknown } : {};
  return safeReturnPath(record.from) || safeReturnPath(record.origin) || fallback;
}

function locationRecord(state: unknown): { from?: unknown; origin?: unknown } {
  return state && typeof state === 'object' ? state as { from?: unknown; origin?: unknown } : {};
}

/** Where Back goes from a member profile. Returning to the group replaces this
 * page so browser Back cannot reopen "User Not Found". */
export function profileBackNavigation(state: unknown, home: string): {
  to: string;
  replace: true;
  state?: { from: string };
} {
  const record = locationRecord(state);
  const from = typeof record.from === 'string' ? record.from.trim() : '';
  if (from.startsWith('/bvsl/groups/') && isManagedDetailPath(from)) {
    return {
      to: from,
      replace: true,
      state: { from: safeReturnPath(record.origin) || home },
    };
  }
  return { to: detailBackTarget(state, home), replace: true };
}

/** Profile opened from a reading group keeps the members tab and the list behind the group. */
export function memberProfileNavigationState(
  location: { pathname: string; search: string; hash?: string; state?: unknown },
  home: string,
): { from: string; origin: string } {
  const params = new URLSearchParams(location.search);
  params.set('tab', 'members');
  const query = params.toString();
  const record = locationRecord(location.state);
  return {
    from: `${location.pathname}?${query}${location.hash || ''}`,
    origin: safeReturnPath(record.from) || safeReturnPath(record.origin) || home,
  };
}

/** Current dashboard address, including the tab hash written outside the router. */
export function dashboardReturnPath(): string {
  if (typeof window === 'undefined') return '/bvsl/dashboard';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function viewerDetailHome(profile?: (BvProfileViewer & { segment?: string | null; isBvFacilitator?: boolean }) | null): string {
  const role = String(profile?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const folk = String(profile?.segment || '').trim().toUpperCase() === 'FOLK';
  if (profile?.isBvSubFacilitator || role === 'RGSF' || role === 'SUB_FACILITATOR') return '/rgsf/dashboard';
  if (isBvGroupProfileAdministrator(profile) || ['ADMIN', 'PW_ADMIN', 'SUPER_ADMIN', 'SUPER_GUIDE'].includes(role)) {
    return folk || role === 'GUIDE' || role === 'SUPER_GUIDE' ? '/folk-guide/dashboard' : '/pw-admin/dashboard';
  }
  if (profile?.isSadhanaMentor || role === 'SADHANA_MENTOR') return '/mentor/dashboard';
  if (profile?.isBvSupervisor || profile?.isBvMentor || role === 'BV_MENTOR' || role === 'SUPERVISOR') return '/bv-supervisor/dashboard';
  if (profile?.isBvsl || profile?.isBvFacilitator || ['BVSL', 'RGF', 'FACILITATOR'].includes(role)) return '/bvsl/dashboard';
  if (role === 'GUIDE' || folk) return '/folk-guide/dashboard';
  return '/pw-admin/dashboard';
}

/** The group list for this dashboard. A deleted group must not fall through to Sadhana. */
export function deletedGroupReturnPath(profile?: Parameters<typeof viewerDetailHome>[0]): string {
  const home = viewerDetailHome(profile);
  if (home === '/pw-admin/dashboard' || home === '/folk-guide/dashboard') return `${home}#bhakti-vriksha`;
  if (home === '/bvsl/dashboard' || home === '/rgsf/dashboard') return `${home}#groups`;
  if (home === '/bv-supervisor/dashboard') return `${home}#rgfs`;
  return home;
}
