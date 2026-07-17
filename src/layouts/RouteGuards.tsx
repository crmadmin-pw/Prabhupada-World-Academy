/**
 * Route guard components to prevent users from visiting wrong pages.
 */
import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { AlertTriangle, WifiOff } from 'lucide-react';

/** Redirect users with any profile status away from /register */
export function GuestOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading } = useAuth();
  const { profile, isLoading: profileLoading, profileError } = useUserProfile();
  if (authLoading || profileLoading) return null;

  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm space-y-4">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-2xl">⚠️</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-1">Could Not Load Profile</h2>
            <p className="text-muted-foreground text-sm">{profileError}</p>
          </div>
          <button
            className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (profile?.status === 'ACTIVE') return <Navigate to="/dashboard" replace />;
  if (profile?.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
  if (profile?.status === 'REJECTED') return <Navigate to="/rejected" replace />;
  return <>{children}</>;
}

/** Only allow users with the required status */
export function StatusRoute({
  children,
  required,
}: {
  children: React.ReactNode;
  required: 'PENDING_APPROVAL' | 'REJECTED';
}) {
  const { user, isLoading: authLoading } = useAuth();
  const { profile, isLoading: profileLoading, profileError } = useUserProfile();
  
  // Wait for both auth and profile to finish loading
  if (authLoading || profileLoading) return null;
  
  // Not authenticated at all — go to landing
  if (!user) return <Navigate to="/" replace />;

  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center max-w-sm space-y-4">
          <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <span className="text-2xl">⚠️</span>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-1">Could Not Load Profile</h2>
            <p className="text-muted-foreground text-sm">{profileError}</p>
          </div>
          <button
            className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Profile still null after loading -> unregistered user -> go to register
  if (!profile) return <Navigate to="/register" replace />;

  // Route to the correct page based on status
  if (profile.status !== required) {
    if (profile.status === 'ACTIVE') return <Navigate to="/dashboard" replace />;
    if (profile.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
    if (profile.status === 'REJECTED') return <Navigate to="/rejected" replace />;
  }
  return <>{children}</>;
}

/**
 * Guard for /zite-auth (magic link + OAuth callback page).
 *
 * Strategy:
 *   1. While authLoading → show spinner (with 15s stuck-error fallback)
 *   2. Auth done + profile already loaded (any status) → go straight to /dashboard.
 *      DashboardRouter handles PENDING / REJECTED / INACTIVE / role routing — no need
 *      to block on ZiteAuthPage's resolveUserLogin endpoint call.
 *   3. Auth done + no profile + user exists → ZiteAuthPage renders. It has a hard
 *      20-second absolute timeout that force-navigates to /dashboard, so the user
 *      can NEVER be stuck here for more than 20 seconds.
 *   4. Auth done + no user → ZiteAuthPage handles loginWithRedirect.
 */
export function AuthCallbackGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [isStuck, setIsStuck] = useState(false);

  // NUCLEAR ESCAPE HATCH — if still on this page after 20s, force to /dashboard.
  // ProtectedRoute + DashboardRouter handle auth/profile/role routing from there.
  // This fires unconditionally regardless of authLoading, isStuck, or any other state.
  useEffect(() => {
    const hardTimeout = setTimeout(() => {
      window.location.href = '/dashboard';
    }, 20_000);
    return () => clearTimeout(hardTimeout);
  }, []);

  useEffect(() => {
    if (!authLoading) {
      setIsStuck(false);
      return;
    }
    const timer = setTimeout(() => setIsStuck(true), 15_000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  // ── Still exchanging token ────────────────────────────────────────────────
  if (authLoading) {
    if (isStuck) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-sm p-8 flex flex-col gap-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                <WifiOff className="w-7 h-7 text-destructive" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Unable to Complete Sign-In</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  We couldn't reach the authentication server. This usually means your current network is blocking the connection.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold flex items-center gap-2 mb-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                What to try
              </p>
              <ul className="space-y-1.5">
                {[
                  'Switch from mobile data to WiFi (or vice versa)',
                  'Try a different browser (Chrome recommended)',
                  'Check if you\'re on a restricted network (office/school WiFi)',
                ].map(tip => (
                  <li key={tip} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
              <button
                onClick={() => navigate('/')}
                className="w-full py-2.5 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                Go to Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-sm p-8 flex flex-col items-center gap-5">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <div className="text-center space-y-1">
            <p className="font-semibold text-base">Authenticating…</p>
            <p className="text-sm text-muted-foreground">Verifying your sign-in token</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Auth resolved ─────────────────────────────────────────────────────────

  // Fast path: profile already in context (any status) → DashboardRouter handles routing.
  // This covers returning users whose profile was cached, AND users who have been
  // pending/rejected — DashboardRouter redirects them to the right page.
  if (profile) return <Navigate to="/dashboard" replace />;

  // No profile yet: let ZiteAuthPage run. It will call resolveUserLogin to set up the
  // profile, and has a hard 20-second absolute timeout to /dashboard as an escape hatch.
  return <>{children}</>;
}
