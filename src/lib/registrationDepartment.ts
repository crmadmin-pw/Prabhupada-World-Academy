export const PW_FLOW_STORAGE_KEY = 'pwa_is_pw_flow';

export type RegistrationDepartment = 'PW' | 'FOLK';

/** Keep the department chosen by the public link across the Google sign-in round trip. */
export function rememberRegistrationDepartment(department: RegistrationDepartment): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('auth_department', department);
    if (department === 'PW') localStorage.setItem(PW_FLOW_STORAGE_KEY, 'true');
    else localStorage.removeItem(PW_FLOW_STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

export function registrationDepartmentFromSearch(search: string): RegistrationDepartment | null {
  const flow = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('flow')?.toLowerCase();
  if (flow === 'pw') return 'PW';
  if (flow === 'folk') return 'FOLK';
  return null;
}

/** The auth return URL wins. Otherwise use the department stored when /pw or / was opened. */
export function isPwRegistrationFlow(search = ''): boolean {
  const fromSearch = registrationDepartmentFromSearch(search);
  if (fromSearch) return fromSearch === 'PW';
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(PW_FLOW_STORAGE_KEY) === 'true'; } catch { return false; }
}

export function applyRegistrationFlowFromSearch(search: string): void {
  const department = registrationDepartmentFromSearch(search);
  if (department) rememberRegistrationDepartment(department);
}

export function authCallbackPath(department: RegistrationDepartment): string {
  return `/auth-callback?flow=${department === 'PW' ? 'pw' : 'folk'}`;
}

export function registrationPath(department: RegistrationDepartment): string {
  return `/register?flow=${department === 'PW' ? 'pw' : 'folk'}`;
}
