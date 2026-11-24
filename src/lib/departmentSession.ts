export type ActiveDepartment = 'FOLK' | 'PW';

export const ACTIVE_DEPARTMENT_SESSION_KEY = 'active_department_mode';
export const ACTIVE_DEPARTMENT_HEADER = 'X-Active-Department';

export function getActiveDepartmentMode(): ActiveDepartment | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = sessionStorage.getItem(ACTIVE_DEPARTMENT_SESSION_KEY);
    return value === 'FOLK' || value === 'PW' ? value : null;
  } catch {
    return null;
  }
}

export function setActiveDepartmentMode(department: ActiveDepartment): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(ACTIVE_DEPARTMENT_SESSION_KEY, department); } catch {}
}

export function clearActiveDepartmentMode(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(ACTIVE_DEPARTMENT_SESSION_KEY); } catch {}
}

export function activeDepartmentRequestHeaders(): Record<string, string> {
  const department = getActiveDepartmentMode();
  return department ? { [ACTIVE_DEPARTMENT_HEADER]: department } : {};
}
