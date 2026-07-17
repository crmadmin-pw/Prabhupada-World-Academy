import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, XCircle, Loader2, WifiOff, CheckCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { resolveUserLogin } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

export default function ZiteAuthPage() {
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const navigate = useNavigate();
  const { forceSetProfile } = useUserProfile();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent double-fires — reset on error so retries always work
  const resolvedEmailRef = useRef<string | null>(null);

  // Call ID — stale abandoned fetch responses are ignored
  const callIdRef = useRef(0);

  // Single page-level elapsed timer (resets on each attempt)
  const mountTimeRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // ── NUCLEAR ESCAPE HATCH ─────────────────────────────────────────────────
  // After 20 seconds from mount, force navigate to /dashboard NO MATTER WHAT.
  // ProtectedRoute + DashboardRouter handle auth, profile loading, and role routing.
  // This guarantees the user is NEVER stuck on this page longer than 20 seconds.
  useEffect(() => {
    const hardTimeout = setTimeout(() => {
      window.location.href = '/dashboard';
    }, 20_000);
    return () => clearTimeout(hardTimeout);
  }, []);

  // Tick every second while loading or resolving
  useEffect(() => {
    if (!isLoading && !resolving) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - mountTimeRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLoading, resolving]);

  useEffect(() => {
    if (isLoading) return;
    if (user?.email && !resolving && !error && resolvedEmailRef.current !== user.email) {
      resolvedEmailRef.current = user.email;
      handleAuthResolution();
    }
  }, [isLoading, user?.email, resolving, error]);

  const handleAuthResolution = async () => {
    if (!user?.email) return;

    // Capture call ID — any older in-flight call will be ignored
    callIdRef.current += 1;
    const myCallId = callIdRef.current;

    // Reset the elapsed clock for this attempt
    mountTimeRef.current = Date.now();
    setElapsed(0);

    setResolving(true);
    setError(null);

    try {
      const result = await resolveUserLogin({ email: user.email });

      if (callIdRef.current !== myCallId) return;

      if (result.action === 'route' && result.route) {
        forceSetProfile(result.user);
        navigate(result.route, { replace: true });
      } else if (result.action === 'guide_email_detected') {
        navigate('/guide-login', { replace: true });
      } else if (result.action === 'register') {
        navigate('/register', { replace: true });
      }
    } catch (err) {
      if (callIdRef.current !== myCallId) return;

      console.error('[ZiteAuthPage] Auth resolution failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      resolvedEmailRef.current = null;
      if (
        msg.includes('fetch') || msg.includes('network') ||
        msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_')
      ) {
        setError('Network error — please check your internet connection and try again. If you are on a restricted network (office/school WiFi), try switching to mobile data.');
      } else {
        setError(msg || 'Unable to verify your account. Please try again.');
      }
    } finally {
      if (callIdRef.current === myCallId) {
        setResolving(false);
      }
    }
  };

  // ── Loading screen ────────────────────────────────────────────────────────
  if (isLoading || resolving) {
    // Phase label tells the user (and helps debug) which step we're on
    const phaseTitle = isLoading ? 'Authenticating…' : 'Loading your account…';
    const phaseDesc = isLoading
      ? 'Verifying your sign-in token'
      : 'Setting up your profile';

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            </div>
            <CardTitle>{phaseTitle}</CardTitle>
            <CardDescription>{phaseDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progressive messaging based on elapsed time */}
            {elapsed < 10_000 && (
              <>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </>
            )}

            {elapsed >= 10_000 && elapsed < 20_000 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                This is taking longer than usual — almost there…
              </p>
            )}

            {/* After 20s the hard timeout fires, so this rarely shows — but just in case */}
            {elapsed >= 20_000 && (
              <>
                <Alert>
                  <WifiOff className="h-4 w-4" />
                  <AlertTitle>Having trouble connecting</AlertTitle>
                  <AlertDescription>
                    Redirecting you to the dashboard — your session should still be valid.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2 pt-1">
                  <Button className="w-full" onClick={() => { window.location.href = '/dashboard'; }}>
                    Go to Dashboard Now
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => logout({ returnTo: window.location.origin })}>
                    Logout &amp; Start Over
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <XCircle className="w-16 h-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl text-center">Login Error</CardTitle>
            <CardDescription className="text-center">Unable to complete sign-in</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Error Details</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>What to check</AlertTitle>
              <AlertDescription>
                <ul className="list-disc list-inside text-sm space-y-1 mt-1">
                  <li>Your Google account may not be registered yet — try registering</li>
                  <li>Your account must be approved by your guide</li>
                  <li>Try logging out and signing in again</li>
                </ul>
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={() => {
                setError(null);
                handleAuthResolution();
              }}>
                Try Again
              </Button>
              <Button variant="outline" className="w-full" onClick={() => { window.location.href = '/dashboard'; }}>
                Go to Dashboard
              </Button>
              <Button variant="outline" className="w-full" onClick={() => logout({ returnTo: window.location.origin })}>
                Logout &amp; Start Over
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (!user) {
    loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` });
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  // ── Fallback: user verified but navigation pending ────────────────────────
  // Reached when resolveUserLogin succeeded but navigate() hasn't fired yet,
  // OR the hard 20s timeout is about to redirect. Always give an escape hatch.
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle className="w-12 h-12 text-primary" />
          </div>
          <CardTitle>Almost there…</CardTitle>
          <CardDescription>
            Your account was verified. Redirecting you now…
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button className="w-full" onClick={() => { window.location.href = '/dashboard'; }}>
            Continue to Dashboard
          </Button>
          <Button variant="outline" className="w-full" onClick={() => logout({ returnTo: window.location.origin })}>
            Logout &amp; Start Over
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
