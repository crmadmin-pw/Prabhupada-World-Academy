// FOLK Sadhana Tracker — App Router (pure routing, zero logic)
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './utils/sadhanaNotification';
import { toast } from 'sonner';

import { Toaster } from '@/components/ui/sonner';
import UserProfileProvider, { useUserProfile } from './contexts/UserProfileContext';
import RoleAcknowledgementHandler from '@/components/dashboard/RoleAcknowledgementHandler';
import { Skeleton } from '@/components/ui/skeleton';
import ErrorBoundary from './layouts/ErrorBoundary';
import ProtectedRoute from './layouts/ProtectedRoute';
import InstallBanner from './components/InstallBanner';
import { GuestOnlyRoute, StatusRoute, AuthCallbackGuard } from './layouts/RouteGuards';

// ── Auth pages ──
import LandingPage from './spa-pages/LandingPage';
import LoginPage from './spa-pages/LoginPage';
import ZiteAuthPage from './spa-pages/ZiteAuthPage';
import GuideLoginPage from './spa-pages/GuideLoginPage';
import RegistrationPage from './spa-pages/RegistrationPage';
import PendingApprovalPage from './spa-pages/PendingApprovalPage';
import RejectedPage from './spa-pages/RejectedPage';
import InactivePage from './spa-pages/InactivePage';
import BvslEntryPage from './spa-pages/BvslEntryPage';

// ── User pages ──
import UserDashboard from './spa-pages/UserDashboard';
import DailySadhanaForm from './spa-pages/DailySadhanaForm';
import HistoryPage from './spa-pages/HistoryPage';
import BhaktiVrikshaPage from './spa-pages/BhaktiVrikshaPage';
import ProfilePage from './spa-pages/ProfilePage';

// ── Guide pages ──
import GuideDashboard from './spa-pages/GuideDashboard';
import GuideFieldSetupPage from './spa-pages/GuideFieldSetupPage';
import GuideUserDetailPage from './spa-pages/GuideUserDetailPage';
import BvGroupDetailPage from './spa-pages/BvGroupDetailPage';

// ── Super Guide pages ──
import SuperGuideDashboard from './spa-pages/SuperGuideDashboard';

// ── BVSL pages ──
import BvslDashboard from './spa-pages/BvslDashboard';
import JoinGroupPage from './spa-pages/JoinGroupPage';
import BvJoinPage from './spa-pages/BvJoinPage';

// ── Sadhana Mentor pages ──
import SadhanaMentorDashboard from './spa-pages/SadhanaMentorDashboard';

// ── BV Mentor pages ──
import BvMentorDashboard from './spa-pages/BvMentorDashboard';
import ApiDocsPage from './spa-pages/ApiDocsPage';
import ServiceManagementPage from './spa-pages/ServiceManagementPage';

// ── Attendance pages ──
import PublicAttendPage from './spa-pages/attendance/PublicAttendPage';
import AttendanceManagePage from './spa-pages/attendance/AttendanceManagePage';
import AttendanceDashboardPage from './spa-pages/attendance/AttendanceDashboardPage';

// ─────────────────────────────────────────────────────────────────────────────
// AUTO VERSION DETECTION
// Works by comparing the hashed JS bundle filename that Zite bakes into
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
  if (window.location.pathname === '/zite-auth') return;
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
    <ErrorBoundary>
      <Router>
        <SafeToaster />
        <VersionChecker />
        <SwRegistrar />
        <InstallBanner />
        <UserProfileProvider>
          <RoleAcknowledgementHandler />
          <Routes>
            {/* Auth — guarded to prevent active users from re-visiting */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage mode="signin" />} />
            <Route path="/signup" element={<LoginPage mode="signup" />} />
            <Route path="/zite-auth" element={<AuthCallbackGuard><ZiteAuthPage /></AuthCallbackGuard>} />
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
            <Route path="/user/dashboard" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><UserDashboard /></ProtectedRoute>} />
            <Route path="/sadhana" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><DailySadhanaForm /></ProtectedRoute>} />
            <Route path="/history" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><HistoryPage /></ProtectedRoute>} />
            <Route path="/bhaktivriksha" element={<ProtectedRoute allowedRoles={[...USER_ROLES]}><BhaktiVrikshaPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

            {/* Guide */}
            <Route path="/guide/dashboard" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE']}><GuideDashboard /></ProtectedRoute>} />
            <Route path="/guide/field-setup" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE']}><GuideFieldSetupPage /></ProtectedRoute>} />
            <Route path="/guide/users/:userId" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'BVSL', 'SADHANA_MENTOR']}><GuideUserDetailPage /></ProtectedRoute>} />
            <Route path="/guide/bv-group/:groupId" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'BV_MENTOR']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/bvsl/groups/:groupId" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR']}><BvGroupDetailPage /></ProtectedRoute>} />
            <Route path="/guide/stats" element={<Navigate to="/guide/dashboard" replace />} />

            {/* Super Guide */}
            <Route path="/super/dashboard" element={<ProtectedRoute allowedRoles={['SUPER_GUIDE']}><SuperGuideDashboard /></ProtectedRoute>} />

            {/* BV Mentor dashboard */}
            <Route path="/bv-mentor/dashboard" element={<ProtectedRoute allowedRoles={['BV_MENTOR']}><BvMentorDashboard /></ProtectedRoute>} />

            {/* BVSL dashboard */}
            <Route path="/bvsl/dashboard" element={<ProtectedRoute allowedRoles={['BVSL', 'SADHANA_MENTOR']}><BvslDashboard /></ProtectedRoute>} />

            {/* Sadhana Mentor dashboard */}
            <Route path="/mentor/dashboard" element={<ProtectedRoute allowedRoles={['SADHANA_MENTOR', 'BVSL']}><SadhanaMentorDashboard /></ProtectedRoute>} />



            {/* Service Allocation Manager — export/import weekly assignments */}
            <Route path="/service-management" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'SERVICE_ALLOCATOR']}><ServiceManagementPage /></ProtectedRoute>} />

            {/* Attendance — public page (no auth required) */}
            <Route path="/attend/:token" element={<PublicAttendPage />} />

            {/* Attendance — admin pages */}
            <Route path="/attendance/manage" element={<ProtectedRoute allowedRoles={['GUIDE', 'SUPER_GUIDE', 'BVSL']}><AttendanceManagePage /></ProtectedRoute>} />
            <Route path="/attendance/dashboard" element={<ProtectedRoute><AttendanceDashboardPage /></ProtectedRoute>} />

            {/* API Docs — Swagger UI */}
            <Route path="/api-docs" element={<ApiDocsPage />} />
          </Routes>
        </UserProfileProvider>
      </Router>
    </ErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VersionChecker — runs on mount + every 5 minutes in background
// Fully automatic: works for every future publish with ZERO manual changes
// ─────────────────────────────────────────────────────────────────────────────
function VersionChecker() {
  const didRunRef = useRef(false);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    // Delay initial check so the app fully loads first (was 2s — too aggressive)
    const initTimer = setTimeout(() => checkAndRefreshIfStale(false), 10_000);

    // Re-check every 20 minutes — version updates aren't urgent enough to check more often
    const interval = setInterval(() => checkAndRefreshIfStale(true), 20 * 60 * 1000);

    // Also re-check when the user returns to the tab after being away
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAndRefreshIfStale(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearTimeout(initTimer);
      clearInterval(interval);
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
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Skeleton className="h-32 w-64" />
    </div>
  );
  if (!profile) return <Navigate to="/register" replace />;
  if (profile.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
  if (profile.status === 'REJECTED') return <Navigate to="/rejected" replace />;
  if ((profile.status as string) === 'INACTIVE') return <Navigate to="/inactive" replace />;
  if (profile.role === 'SUPER_GUIDE') return <Navigate to="/super/dashboard" replace />;
  if (profile.role === 'GUIDE') return <Navigate to="/guide/dashboard" replace />;
  // BV Mentor: lands on their dedicated BV management dashboard
  if (profile.isBvMentor) return <Navigate to="/bv-mentor/dashboard" replace />;
  // P1-002 FIX: BVSL and Mentor land on "My Sadhana" (user dashboard) first.
  return <Navigate to="/user/dashboard" replace />;
}
