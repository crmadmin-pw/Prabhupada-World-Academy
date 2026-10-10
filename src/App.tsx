import { MotionConfig } from 'framer-motion';
// FOLK Sadhana Tracker — App Router (pure routing, zero logic)
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './utils/sadhanaNotification';
import { Toaster } from '@/components/ui/sonner';
import UserProfileProvider, { useUserProfile } from './contexts/UserProfileContext';
import RoleAcknowledgementHandler from '@/components/dashboard/RoleAcknowledgementHandler';
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
const GuideLoginPage = lazy(() => import('./spa-pages/GuideLoginPage'));
const RegistrationPage = lazy(() => import('./spa-pages/RegistrationPage'));
const PendingApprovalPage = lazy(() => import('./spa-pages/PendingApprovalPage'));
const RejectedPage = lazy(() => import('./spa-pages/RejectedPage'));
const AccountDeletionPage = lazy(() => import('./spa-pages/AccountDeletionPage'));
const InactivePage = lazy(() => import('./spa-pages/InactivePage'));
const BvslEntryPage = lazy(() => import('./spa-pages/BvslEntryPage'));

// Route-level chunks keep unrelated departments and dashboards out of the
// first bundle. Their frequently used inner tabs preload after dashboard idle.
const FolkUserDashboard = lazy(() => import('./spa-pages/FolkUserDashboard'));
const PwUserDashboard = lazy(() => import('./spa-pages/PwUserDashboard'));
const DailySadhanaForm = lazy(() => import('./spa-pages/DailySadhanaForm'));
const HistoryPage = lazy(() => import('./spa-pages/HistoryPage'));
const BhaktiVrikshaPage = lazy(() => import('./spa-pages/BhaktiVrikshaPage'));
const ProfilePage = lazy(() => import('./spa-pages/ProfilePage'));
const GuideFieldSetupPage = lazy(() => import('./spa-pages/GuideFieldSetupPage'));
const GuideUserDetailPage = lazy(() => import('./spa-pages/GuideUserDetailPage'));
const BvGroupDetailPage = lazy(() => import('./spa-pages/BvGroupDetailPage'));

import { useAuth } from '@/lib/auth-sdk';

// ── Super Guide & Admin pages ──
const PwAdminDashboard = lazy(() => import('./spa-pages/PwAdminDashboard'));
const FolkGuideDashboard = lazy(() => import('./spa-pages/FolkGuideDashboard'));

// ── BVSL, RGF & RGSF pages ──
const RgfDashboard = lazy(() => import('./spa-pages/RgfDashboard'));
const RgsfDashboard = lazy(() => import('./spa-pages/RgsfDashboard'));
const JoinGroupPage = lazy(() => import('./spa-pages/JoinGroupPage'));
const BvJoinPage = lazy(() => import('./spa-pages/BvJoinPage'));

// ── Sadhana Mentor pages ──
const SadhanaMentorDashboard = lazy(() => import('./spa-pages/SadhanaMentorDashboard'));

// ── BV Mentor pages ──
const BvSupervisorDashboard = lazy(() => import('./spa-pages/BvSupervisorDashboard'));
const ServiceManagementPage = lazy(() => import('./spa-pages/ServiceManagementPage'));

// ── Attendance pages ──
const PublicAttendPage = lazy(() => import('./spa-pages/attendance/PublicAttendPage'));
const AttendanceManagePage = lazy(() => import('./spa-pages/attendance/AttendanceManagePage'));
const AttendanceDashboardPage = lazy(() => import('./spa-pages/attendance/AttendanceDashboardPage'));

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
          <RoleAcknowledgementHandler />
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

function DashboardRouter() {
  const { profile, isLoading } = useUserProfile();
  const { user } = useAuth();
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Skeleton className="h-32 w-64" />
    </div>
  );
  if (!profile) return <Navigate to="/register" replace />;
  if (profile.status === 'PENDING_DELETION') return <Navigate to="/account-deletion" replace />;
  if (profile.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
  if (profile.status === 'REJECTED') return <Navigate to="/rejected" replace />;
  if ((profile.status as string) === 'INACTIVE') return <Navigate to="/inactive" replace />;

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
    return isPw ? <Navigate to={`/pw-admin/dashboard${suffix}`} replace /> : <Navigate to={`/folk-guide/dashboard${suffix}`} replace />;
  }

  // Sadhana Mentor
  if (profile.isSadhanaMentor || (profile.role as string) === 'SADHANA_MENTOR' || (profile.role as string) === 'Sadhana Mentor') {
    return <Navigate to={`/mentor/dashboard${suffix}`} replace />;
  }

  // Supervisor
  if (profile.isBvSupervisor || profile.isBvMentor) return <Navigate to={`/bv-supervisor/dashboard${suffix}`} replace />;

  // RGSF (Sub-Facilitator)
  if (profile.isBvSubFacilitator && !profile.isBvFacilitator && !profile.isBvsl) {
    return <Navigate to={`/rgsf/dashboard${suffix}`} replace />;
  }

  // RGF (Reading Group Facilitator) / BVSL
  if (profile.isBvFacilitator || profile.isBvsl) {
    return <Navigate to={`/rgf/dashboard${suffix}`} replace />;
  }

  // Guide. FOLK guides use the guide dashboard. A Prabhupada World account whose
  // role is Guide, and who was not already routed as an admin above, is a member.
  // Sending them to /pw-admin/dashboard would bounce: that shell no longer admits GUIDE or USER.
  const userRoleStr = (profile.role as string) || '';
  const normalizedGuideRole = userRoleStr.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalizedGuideRole === 'SUPER_GUIDE' || normalizedGuideRole === 'GUIDE') {
    if (normalizedGuideRole === 'GUIDE' && isPw) {
      return <Navigate to={`${getUserDashboardPath(profile)}${suffix}`} replace />;
    }
    return isPw ? <Navigate to={`/pw-admin/dashboard${suffix}`} replace /> : <Navigate to={`/folk-guide/dashboard${suffix}`} replace />;
  }

  // Default: regular user — route by department (determined by mentor chosen at registration)
  return <Navigate to={`${getUserDashboardPath(profile)}${suffix}`} replace />;
}
