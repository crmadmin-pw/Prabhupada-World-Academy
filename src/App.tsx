import { MotionConfig } from 'framer-motion';
// FOLK Sadhana Tracker — App Router (pure routing, zero logic)
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './utils/sadhanaNotification';
import { toast } from 'sonner';

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

// ── Auth pages ──
import LandingPage from './spa-pages/LandingPage';
import LoginPage from './spa-pages/LoginPage';
import AuthCallbackPage from './spa-pages/AuthCallbackPage';
const GuideLoginPage = lazy(() => import('./spa-pages/GuideLoginPage'));
const RegistrationPage = lazy(() => import('./spa-pages/RegistrationPage'));
const PendingApprovalPage = lazy(() => import('./spa-pages/PendingApprovalPage'));
const RejectedPage = lazy(() => import('./spa-pages/RejectedPage'));
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

// ─────────────────────────────────────────────────────────────────────────────
// AUTO VERSION DETECTION
// Works by comparing the hashed JS bundle filename that build process bakes into
// index.html at publish time vs what the browser currently has loaded.
// Every publish produces a NEW hash → detected automatically. No manual bumps.
// ─────────────────────────────────────────────────────────────────────────────

/** Key to throttle reloads — stores the timestamp of last auto-reload */
const RELOAD_TS_KEY = 'folk_last_auto_reload';
/** Minimum ms between auto-reloads (30 s) — prevents infinite loops */
const RELOAD_COOLDOWN_MS = 30_000;

/** Get the /assets/index-*.js pathname currently loaded in this tab */
function getLocalScriptPath(): string | null {
  for (const el of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    try {
      const path = new URL(el.src, window.location.origin).pathname;
      if (path.startsWith('/assets/index-') && path.endsWith('.js')) return path;
    } catch {
      // ignore
    }
  }
  return null;
}

/** Fetch the live index.html and extract its hashed JS bundle path */
async function fetchRemoteScriptPath(): Promise<string | null> {
  const res = await fetch('/?_bust=' + Date.now(), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', Pragma: 'no-cache' },
  });
  const html = await res.text();
  const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  return match ? match[1] : null;
}

/** Core check — returns true if a new version was detected and a reload was triggered */
async function checkAndRefreshIfStale(isBackground: boolean): Promise<void> {
  // Never reload during auth callbacks — the OAuth token is one-time use and a
  // mid-callback reload consumes it without establishing a session, causing a
  // permanent broken auth state (stuck spinner / redirect loop).
  if (window.location.pathname === '/auth-callback') return;
  try {
    const [localPath, remotePath] = await Promise.all([
      Promise.resolve(getLocalScriptPath()),
      fetchRemoteScriptPath(),
    ]);

    if (!localPath || !remotePath) return;
    if (localPath === remotePath) return; // ✅ Already on latest

    // Guard: don't reload if we just did so recently (prevents loops)
    const lastReload = parseInt(sessionStorage.getItem(RELOAD_TS_KEY) ?? '0', 10);
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) return;

    // Clear stale local data before reload
    for (const key of Object.keys(sessionStorage)) {
      if (key !== RELOAD_TS_KEY) sessionStorage.removeItem(key);
    }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('pwa_') || key.startsWith('svc_') || key.startsWith('folk_cache_')) {
        localStorage.removeItem(key);
      }
    }

    sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));

    if (isBackground) {
      toast('✨ New version available — refreshing in 3 seconds…');
      setTimeout(() => {
        window.location.href = window.location.origin + window.location.pathname + '?_v=' + Date.now();
      }, 3000);
    } else {
      // Silent immediate reload on first page load
      window.location.href = window.location.origin + window.location.pathname + '?_v=' + Date.now();
    }
  } catch {
    // Network / parse error — don't reload, silently continue
  }
}

// ─────────────────────────────────────────────────────────────────────────────

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
            <Route path="/guide-login" element={<GuideLoginPage />} />
            <Route path="/register" element={<GuestOnlyRoute><RegistrationPage /></GuestOnlyRoute>} />
            <Route path="/pending" element={<StatusRoute required="PENDING_APPROVAL"><PendingApprovalPage /></StatusRoute>} />
            <Route path="/rejected" element={<StatusRoute required="REJECTED"><RejectedPage /></StatusRoute>} />
            <Route path="/inactive" element={<InactivePage />} />
            <Route path="/bvsl" element={<BvslEntryPage />} />
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
            <Route path="/guide/bv-group/:groupId" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'BV_MENTOR', 'ADMIN', 'PW_ADMIN', 'USER']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/bvsl/groups/:groupId" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN', 'GUIDE', 'SUPER_GUIDE', 'BV_MENTOR', 'USER']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/guide/stats" element={<Navigate to="/folk-guide/dashboard" replace />} />

            {/* Super Guide & Super Admin */}
            <Route path="/super/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN']}><FolkGuideDashboard /></ProtectedRoute>} />
            <Route path="/folk-guide/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN', 'USER']}><FolkGuideDashboard /></ProtectedRoute>} />
            <Route path="/pw-admin/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN', 'USER']}><PwAdminDashboard /></ProtectedRoute>} />
            <Route path="/super-admin/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN', 'PW_ADMIN', 'USER']}><PwAdminDashboard /></ProtectedRoute>} />

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

// ─────────────────────────────────────────────────────────────────────────────
// VersionChecker — one delayed check plus a check when the app becomes visible.
// Fully automatic: works for every future publish with ZERO manual changes
// ─────────────────────────────────────────────────────────────────────────────
function VersionChecker() {
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    // Delay initial check so the app fully loads first (was 2s — too aggressive)
    const initTimer = setTimeout(() => checkAndRefreshIfStale(false), 10_000);

    // Also re-check when the user returns to the tab after being away
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAndRefreshIfStale(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearTimeout(initTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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

  // Guide / Mentor
  const userRoleStr = (profile.role as string) || '';
  if (userRoleStr === 'SUPER_GUIDE' || userRoleStr === 'GUIDE' || userRoleStr === 'Super Guide' || userRoleStr === 'Guide') {
    return isPw ? <Navigate to={`/pw-admin/dashboard${suffix}`} replace /> : <Navigate to={`/folk-guide/dashboard${suffix}`} replace />;
  }

  // Default: regular user — route by department (determined by mentor chosen at registration)
  return <Navigate to={`${getUserDashboardPath(profile)}${suffix}`} replace />;
}
