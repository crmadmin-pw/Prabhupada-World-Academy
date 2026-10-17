// One loader per screen. Preload and the route share it, so the download
// started during sign-in is the same chunk the route renders.

export const loadGuideLoginPage = () => import('@/spa-pages/GuideLoginPage');
export const loadRegistrationPage = () => import('@/spa-pages/RegistrationPage');
export const loadPendingApprovalPage = () => import('@/spa-pages/PendingApprovalPage');
export const loadRejectedPage = () => import('@/spa-pages/RejectedPage');
export const loadAccountDeletionPage = () => import('@/spa-pages/AccountDeletionPage');
export const loadAccountDeletedPage = () => import('@/spa-pages/AccountDeletedPage');
export const loadInactivePage = () => import('@/spa-pages/InactivePage');
export const loadBvslEntryPage = () => import('@/spa-pages/BvslEntryPage');
export const loadFolkUserDashboard = () => import('@/spa-pages/FolkUserDashboard');
export const loadPwUserDashboard = () => import('@/spa-pages/PwUserDashboard');
export const loadDailySadhanaForm = () => import('@/spa-pages/DailySadhanaForm');
export const loadHistoryPage = () => import('@/spa-pages/HistoryPage');
export const loadBhaktiVrikshaPage = () => import('@/spa-pages/BhaktiVrikshaPage');
export const loadProfilePage = () => import('@/spa-pages/ProfilePage');
export const loadGuideFieldSetupPage = () => import('@/spa-pages/GuideFieldSetupPage');
export const loadGuideUserDetailPage = () => import('@/spa-pages/GuideUserDetailPage');
export const loadBvGroupDetailPage = () => import('@/spa-pages/BvGroupDetailPage');
export const loadPwAdminDashboard = () => import('@/spa-pages/PwAdminDashboard');
export const loadFolkGuideDashboard = () => import('@/spa-pages/FolkGuideDashboard');
export const loadReportsTab = () => import('@/components/guide/ReportsTab');
export const loadRgfDashboard = () => import('@/spa-pages/RgfDashboard');
export const loadRgsfDashboard = () => import('@/spa-pages/RgsfDashboard');
export const loadJoinGroupPage = () => import('@/spa-pages/JoinGroupPage');
export const loadBvJoinPage = () => import('@/spa-pages/BvJoinPage');
export const loadSadhanaMentorDashboard = () => import('@/spa-pages/SadhanaMentorDashboard');
export const loadBvSupervisorDashboard = () => import('@/spa-pages/BvSupervisorDashboard');
export const loadServiceManagementPage = () => import('@/spa-pages/ServiceManagementPage');
export const loadPublicAttendPage = () => import('@/spa-pages/attendance/PublicAttendPage');
export const loadAttendanceManagePage = () => import('@/spa-pages/attendance/AttendanceManagePage');
export const loadAttendanceDashboardPage = () => import('@/spa-pages/attendance/AttendanceDashboardPage');

/** Download this URL's page while sign-in and the profile are still resolving.
 * Protected pages do not render their screen until the profile returns, so
 * without this the page's JavaScript cannot start until that wait is over.
 * Code only: routing and access still wait for the verified profile. */
export function preloadRoute(path: string) {
  const loads: Array<() => Promise<unknown>> = [];
  const starts = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (starts('/pw-admin') || starts('/super-admin')) loads.push(loadPwAdminDashboard, loadReportsTab);
  else if (starts('/folk-guide') || path === '/super' || path.startsWith('/super/')) loads.push(loadFolkGuideDashboard, loadReportsTab);
  else if (starts('/user/pw-dashboard')) loads.push(loadPwUserDashboard);
  else if (starts('/user/folk-dashboard')) loads.push(loadFolkUserDashboard);
  else if (starts('/sadhana')) loads.push(loadDailySadhanaForm);
  else if (starts('/history')) loads.push(loadHistoryPage);
  else if (starts('/bhaktivriksha')) loads.push(loadBhaktiVrikshaPage);
  else if (starts('/profile')) loads.push(loadProfilePage);
  else if (starts('/guide/field-setup')) loads.push(loadGuideFieldSetupPage);
  else if (starts('/guide/users') || starts('/rgsf/users')) loads.push(loadGuideUserDetailPage);
  else if (starts('/guide/bv-group') || starts('/bvsl/groups')) loads.push(loadBvGroupDetailPage);
  else if (starts('/rgf') || path === '/bvsl/dashboard') loads.push(loadRgfDashboard);
  else if (starts('/rgsf')) loads.push(loadRgsfDashboard);
  else if (starts('/bv-supervisor') || starts('/supervisor') || starts('/bv-mentor')) loads.push(loadBvSupervisorDashboard);
  else if (starts('/mentor')) loads.push(loadSadhanaMentorDashboard);
  else if (starts('/service-management')) loads.push(loadServiceManagementPage);
  else if (starts('/attend')) loads.push(loadPublicAttendPage);
  else if (starts('/attendance/manage')) loads.push(loadAttendanceManagePage);
  else if (starts('/attendance/dashboard')) loads.push(loadAttendanceDashboardPage);
  else if (starts('/guide-login')) loads.push(loadGuideLoginPage);
  else if (starts('/register')) loads.push(loadRegistrationPage);
  else if (starts('/pending')) loads.push(loadPendingApprovalPage);
  else if (starts('/rejected')) loads.push(loadRejectedPage);
  else if (starts('/account-deletion')) loads.push(loadAccountDeletionPage);
  else if (starts('/account-deleted')) loads.push(loadAccountDeletedPage);
  else if (starts('/inactive')) loads.push(loadInactivePage);
  else if (path === '/bvsl') loads.push(loadBvslEntryPage);
  else if (starts('/join-group') || path.startsWith('/join/')) loads.push(loadJoinGroupPage);
  else if (starts('/bv/join')) loads.push(loadBvJoinPage);
  for (const load of loads) void load().catch(() => {});
}

if (typeof window !== 'undefined') preloadRoute(window.location.pathname);
