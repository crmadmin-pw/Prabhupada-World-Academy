import { MotionConfig } from 'framer-motion';
// FOLK Sadhana Tracker — App Router (pure routing, zero logic)
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './utils/sadhanaNotification';
import { Toaster } from '@/components/ui/sonner';
import UserProfileProvider, { useUserProfile } from './contexts/UserProfileContext';
import RealtimeSyncProvider from '@/components/RealtimeSyncProvider';
import { Skeleton } from '@/components/ui/skeleton';
import ErrorBoundary from './layouts/ErrorBoundary';
import ProtectedRoute from './layouts/ProtectedRoute';
import UserDashboardRoute from './layouts/UserDashboardRoute';
import { getUserDashboardPath } from './lib/userDashboardRoutes';
import InstallBanner from './components/InstallBanner';
import { GuestOnlyRoute, StatusRoute, AuthCallbackGuard } from './layouts/RouteGuards';
import { startAppVersionChecks } from '@/lib/appVersion';

// ── Auth pages ──
import LandingPage from './spa-pages/LandingPage';
import LoginPage from './spa-pages/LoginPage';
import AuthCallbackPage from './spa-pages/AuthCallbackPage';
import AccountLinkPendingPage from './spa-pages/AccountLinkPendingPage';
import { acknowledgementPopup } from '@/lib/roleNoticeText';
import {
  loadAccountDeletedPage,
  loadAccountDeletionPage,
  loadAttendanceDashboardPage,
  loadAttendanceManagePage,
  loadBhaktiVrikshaPage,
  loadBvGroupDetailPage,
  loadBvJoinPage,
  loadBvslEntryPage,
  loadBvSupervisorDashboard,
  loadDailySadhanaForm,
  loadFolkGuideDashboard,
  loadFolkUserDashboard,
  loadGuideFieldSetupPage,
  loadGuideLoginPage,
  loadGuideUserDetailPage,
  loadHistoryPage,
  loadInactivePage,
  loadJoinGroupPage,
  loadPendingApprovalPage,
  loadProfilePage,
  loadPublicAttendPage,
  loadPwAdminDashboard,
  loadPwUserDashboard,
  loadRegistrationPage,
  loadRejectedPage,
  loadRgfDashboard,
  loadRgsfDashboard,
  loadSadhanaMentorDashboard,
  loadServiceManagementPage,
  preloadRoute,
} from '@/lib/routePreload';

const RoleAcknowledgementDialog = lazy(() => import('@/components/dashboard/RoleAcknowledgementHandler'));

const GuideLoginPage = lazy(loadGuideLoginPage);
const RegistrationPage = lazy(loadRegistrationPage);
const PendingApprovalPage = lazy(loadPendingApprovalPage);
const RejectedPage = lazy(loadRejectedPage);
const AccountDeletionPage = lazy(loadAccountDeletionPage);
const AccountDeletedPage = lazy(loadAccountDeletedPage);
const InactivePage = lazy(loadInactivePage);
const BvslEntryPage = lazy(loadBvslEntryPage);
const FolkUserDashboard = lazy(loadFolkUserDashboard);
const PwUserDashboard = lazy(loadPwUserDashboard);
const DailySadhanaForm = lazy(loadDailySadhanaForm);
const HistoryPage = lazy(loadHistoryPage);
const BhaktiVrikshaPage = lazy(loadBhaktiVrikshaPage);
const ProfilePage = lazy(loadProfilePage);
const GuideFieldSetupPage = lazy(loadGuideFieldSetupPage);
const GuideUserDetailPage = lazy(loadGuideUserDetailPage);
const BvGroupDetailPage = lazy(loadBvGroupDetailPage);
const PwAdminDashboard = lazy(loadPwAdminDashboard);
const FolkGuideDashboard = lazy(loadFolkGuideDashboard);
const RgfDashboard = lazy(loadRgfDashboard);
const RgsfDashboard = lazy(loadRgsfDashboard);
const JoinGroupPage = lazy(loadJoinGroupPage);
const BvJoinPage = lazy(loadBvJoinPage);
const SadhanaMentorDashboard = lazy(loadSadhanaMentorDashboard);
const BvSupervisorDashboard = lazy(loadBvSupervisorDashboard);
const ServiceManagementPage = lazy(loadServiceManagementPage);
const PublicAttendPage = lazy(loadPublicAttendPage);
const AttendanceManagePage = lazy(loadAttendanceManagePage);
const AttendanceDashboardPage = lazy(loadAttendanceDashboardPage);

// Roles that can access user-level pages (everyone except Guide/Super Guide)
const USER_ROLES = ['USER', 'BVSL', 'SADHANA_MENTOR'] as const;

export default function App() {
  return (
    <MotionConfig reducedMotion="user"><ErrorBoundary>
      <Router>
        <SafeToaster />
        <VersionChecker />
        <SwRegistrar />
        <InstallBanner />
        <UserProfileProvider>
          <RealtimeSyncProvider />
          <RoleAcknowledgementGate />
          <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            {/* Auth — guarded to prevent active users from re-visiting */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage mode="signin" />} />
            <Route path="/signup" element={<LoginPage mode="signup" />} />
            <Route path="/pw" element={<LandingPage isPw={true} />} />
            <Route path="/pw/signup" element={<LandingPage isPw={true} />} />
            <Route path="/auth-callback" element={<AuthCallbackGuard><AuthCallbackPage /></AuthCallbackGuard>} />
            <Route path="/account-link-pending" element={<AccountLinkPendingPage />} />
            <Route path="/guide-login" element={<GuideLoginPage />} />
            <Route path="/register" element={<GuestOnlyRoute><RegistrationPage /></GuestOnlyRoute>} />
            <Route path="/pending" element={<StatusRoute required="PENDING_APPROVAL"><PendingApprovalPage /></StatusRoute>} />
            <Route path="/rejected" element={<StatusRoute required="REJECTED"><RejectedPage /></StatusRoute>} />
            <Route path="/account-deletion" element={<AccountDeletionPage />} />
            <Route path="/account-deleted" element={<AccountDeletedPage />} />
            <Route path="/inactive" element={<InactivePage />} />
            <Route path="/bvsl" element={<BvslEntryPage />} />
            <Route path="/join/:token/pw" element={<JoinGroupPage />} />
            <Route path="/join-group" element={<JoinGroupPage />} />
            <Route path="/bv/join" element={<BvJoinPage />} />

            {/* Dashboard router — sends users to their primary dashboard */}
            <Route path="/dashboard" element={<ProtectedRoute><DashboardRouter /></ProtectedRoute>} />

            {/* User — accessible by all non-guide roles */}
            <Route path="/user/dashboard" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><UserDashboardRoute /></ProtectedRoute>} />
            {/* Segment-specific user dashboards (FOLK vs Prabhupada World) */}
            <Route path="/user/folk-dashboard" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><UserDashboardRoute><FolkUserDashboard /></UserDashboardRoute></ProtectedRoute>} />
            <Route path="/user/pw-dashboard" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><UserDashboardRoute><PwUserDashboard /></UserDashboardRoute></ProtectedRoute>} />
            <Route path="/sadhana" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><DailySadhanaForm /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><HistoryPage /></ProtectedRoute>} />
            <Route path="/bhaktivriksha" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><BhaktiVrikshaPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

            {/* Guide */}
            <Route path="/guide/dashboard" element={<Navigate to="/folk-guide/dashboard" replace />} />
            <Route path="/guide/field-setup" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN']}><GuideFieldSetupPage /></ProtectedRoute>} />
            <Route path="/guide/users/:userId" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'BVSL', 'SADHANA_MENTOR', 'BV_MENTOR']}><GuideUserDetailPage /></ProtectedRoute>} />
            <Route path="/rgsf/users/:userId" element={<ProtectedRoute allowedRoles={['RGSF']}><GuideUserDetailPage /></ProtectedRoute>} />
            <Route path="/guide/bv-group/:groupId" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'BV_MENTOR', 'ADMIN', 'PW_ADMIN']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/bvsl/groups/:groupId" element={<ProtectedRoute allowedRoles={['BVSL', 'RGSF', 'SADHANA_MENTOR', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN', 'GUIDE', 'SUPER_GUIDE', 'BV_MENTOR']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/guide/stats" element={<Navigate to="/folk-guide/dashboard" replace />} />

            {/* Management dashboards. Plain USER is intentionally absent: ProtectedRoute
                treats USER as "any approved member", so listing it opened these shells to everyone.
                Guide is included only on the FOLK guide dashboard, which that role actually uses.
                Admin flags (isBvAdmin / isBvSuperAdmin) still pass via ProtectedRoute. */}
            <Route path="/super/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN']}><FolkGuideDashboard /></ProtectedRoute>} />
            <Route path="/folk-guide/dashboard" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN']}><FolkGuideDashboard /></ProtectedRoute>} />
            <Route path="/pw-admin/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN']}><PwAdminDashboard /></ProtectedRoute>} />
            <Route path="/super-admin/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN']}><PwAdminDashboard /></ProtectedRoute>} />

            {/* Supervisor dashboard (formerly BV Mentor) — accessible by BV_MENTOR/isBvSupervisor, Guides, and Admins */}
            <Route path="/bv-supervisor/dashboard" element={<ProtectedRoute allowedRoles={['BV_MENTOR', 'GUIDE', 'SUPER_GUIDE', 'ADMIN']}><BvSupervisorDashboard /></ProtectedRoute>} />
            <Route path="/supervisor/dashboard" element={<ProtectedRoute allowedRoles={['BV_MENTOR', 'GUIDE', 'SUPER_GUIDE', 'ADMIN']}><BvSupervisorDashboard /></ProtectedRoute>} />
            <Route path="/bv-mentor/dashboard" element={<ProtectedRoute allowedRoles={['BV_MENTOR', 'GUIDE', 'SUPER_GUIDE', 'ADMIN']}><BvSupervisorDashboard /></ProtectedRoute>} />

            {/* Reading Group Facilitator (RGF) — accessible by BVSL/isBvFacilitator role */}
            <Route path="/rgf/dashboard" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR', 'GUIDE', 'SUPER_GUIDE']}><RgfDashboard /></ProtectedRoute>} />
            {/* RGSF dashboard — base role is 'User' but isBvSubFacilitator flag gates access via ProtectedRoute */}
            <Route path="/rgsf/dashboard" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR', 'GUIDE', 'SUPER_GUIDE', 'RGSF']}><RgsfDashboard /></ProtectedRoute>} />
            <Route path="/bvsl/dashboard" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR', 'GUIDE', 'SUPER_GUIDE']}><RgfDashboard /></ProtectedRoute>} />

            {/* Sadhana Mentor dashboard */}
            <Route path="/mentor/dashboard" element={<ProtectedRoute allowedRoles={['SADHANA_MENTOR', 'BVSL']}><SadhanaMentorDashboard /></ProtectedRoute>} />



            {/* Service Allocation Manager — export/import weekly assignments */}
            <Route path="/service-management" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SERVICE_ALLOCATOR']}><ServiceManagementPage /></ProtectedRoute>} />

            {/* Attendance — public page (no auth required) */}
            <Route path="/attend/:token" element={<PublicAttendPage />} />

            {/* Attendance — admin pages */}
            <Route path="/attendance/manage" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE']}><AttendanceManagePage /></ProtectedRoute>} />
            <Route path="/attendance/dashboard" element={<ProtectedRoute><AttendanceDashboardPage /></ProtectedRoute>} />

            {/* API docs page removed from production */}
          </Routes>
          </Suspense>
        </UserProfileProvider>
      </Router>
    </ErrorBoundary></MotionConfig>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-6" aria-label="Loading page">
      <Skeleton className="h-10 w-72 max-w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function VersionChecker() {
  useEffect(() => startAppVersionChecks(), []);
  return null;
}

// Register SW on app load — fire-and-forget
function SwRegistrar() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    registerServiceWorker();
  }, []);
  return null;
}

// Deferred Toaster: only render after DOM is fully ready
function SafeToaster() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <Toaster />;
}

function RoleAcknowledgementGate() {
  const { profile } = useUserProfile();
  // The dialog chunk stays out of the first download. The same notice order
  // still opens it on any page once the profile says one is waiting.
  if (!acknowledgementPopup(profile)) return null;
  return (
    <Suspense fallback={null}>
      <RoleAcknowledgementDialog />
    </Suspense>
  );
}

function DashboardRouter() {
  const { profile, isLoading } = useUserProfile();
  const redirectTo = (path: string) => {
    preloadRoute(path.split(/[?#]/)[0]);
    return <Navigate to={path} replace />;
  };
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Skeleton className="h-32 w-64" />
    </div>
  );
  if (!profile) return redirectTo('/register');
  if (profile.status === 'ACCOUNT_DELETED') return redirectTo('/account-deleted');
  if (profile.status === 'PENDING_DELETION') return redirectTo('/account-deletion');
  if (profile.status === 'PENDING_APPROVAL') return redirectTo('/pending');
  if (profile.status === 'REJECTED') return redirectTo('/rejected');
  if ((profile.status as string) === 'INACTIVE') return redirectTo('/inactive');

  const suffix = typeof window !== 'undefined' ? `${window.location.search}${window.location.hash}` : '';

  // ── BV Hierarchy Routing (top → bottom) ──

  const isFolk = profile.segment === 'FOLK';
  const isPw = !isFolk;

  // Super Admin / Admin
  const isSuperAdmin = !!(
    (profile as any)?.isPwAdmin ||
    profile?.isBvSuperAdmin ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'SUPER_GUIDE'
  );

  if (isSuperAdmin || profile.isBvAdmin || (profile.role as string) === 'ADMIN') {
    return redirectTo(isPw ? `/pw-admin/dashboard${suffix}` : `/folk-guide/dashboard${suffix}`);
  }

  // Sadhana Mentor
  if (profile.isSadhanaMentor || (profile.role as string) === 'SADHANA_MENTOR' || (profile.role as string) === 'Sadhana Mentor') {
    return redirectTo(`/mentor/dashboard${suffix}`);
  }

  // Supervisor
  if (profile.isBvSupervisor || profile.isBvMentor) return redirectTo(`/bv-supervisor/dashboard${suffix}`);

  // RGSF (Sub-Facilitator)
  if (profile.isBvSubFacilitator && !profile.isBvFacilitator && !profile.isBvsl) {
    return redirectTo(`/rgsf/dashboard${suffix}`);
  }

  // RGF (Reading Group Facilitator) / BVSL
  if (profile.isBvFacilitator || profile.isBvsl) {
    return redirectTo(`/rgf/dashboard${suffix}`);
  }

  // Guide. FOLK guides use the guide dashboard. A Prabhupada World account whose
  // role is Guide, and who was not already routed as an admin above, is a member.
  // Sending them to /pw-admin/dashboard would bounce: that shell no longer admits GUIDE or USER.
  const userRoleStr = (profile.role as string) || '';
  const normalizedGuideRole = userRoleStr.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalizedGuideRole === 'SUPER_GUIDE' || normalizedGuideRole === 'GUIDE') {
    if (normalizedGuideRole === 'GUIDE' && isPw) {
      return redirectTo(`${getUserDashboardPath(profile)}${suffix}`);
    }
    return redirectTo(isPw ? `/pw-admin/dashboard${suffix}` : `/folk-guide/dashboard${suffix}`);
  }

  // Default: regular user — route by department (determined by mentor chosen at registration)
  return redirectTo(`${getUserDashboardPath(profile)}${suffix}`);
}
