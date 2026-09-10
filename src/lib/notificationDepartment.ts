import { getUserDepartment } from './userDashboardRoutes';

/** Match dashboard department rules, including legacy FOLK membership flags. */
export function getNotificationDepartment(user: any): 'PW' | 'FOLK' {
  return getUserDepartment({
    ...user,
    isFolkUser: !!(user?.isFolkUser || user?.isFolkLead || user?.residencyId),
  });
}

/**
 * Leadership accounts monitor other devotees' Sadhana and never submit a
 * personal daily Sadhana form. Keep this recipient rule shared by every
 * Sadhana reminder channel so neither in-app nor native Web Push reaches
 * them.
 */
export function isSadhanaReminderEligibleUser(user: any): boolean {
  const role = String(user?.role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  const isLeadershipRole = new Set([
    'GUIDE',
    'SUPER_GUIDE',
    'SUPERGUIDE',
    'ADMIN',
    'ADMINISTRATOR',
    'SUPER_ADMIN',
    'SUPERADMIN',
    'SUPER_ADMINISTRATOR',
    'PW_ADMIN',
    'PW_SUPER_ADMIN',
    'PW_SUPERADMIN',
  ]).has(role);

  return !isLeadershipRole && !user?.isBvAdmin && !user?.isBvSuperAdmin;
}
