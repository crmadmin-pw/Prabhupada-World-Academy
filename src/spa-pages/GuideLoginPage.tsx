import { useEffect, useRef, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Users, Loader2, XCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { resolveGuideLogin } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

export default function GuideLoginPage() {
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const navigate = useNavigate();
  const { forceSetProfile } = useUserProfile();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAttemptedRef = useRef(false);
  // Track whether we've ever finished the initial auth load — prevents blank on tab switch
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    initialLoadDone.current = true;
    if (user?.email && !resolving && !error && !hasAttemptedRef.current) {
      hasAttemptedRef.current = true;
      handleGuideLoginResolution();
    }
  }, [isLoading, user?.email]);

  const handleGuideLoginResolution = async () => {
    if (!user?.email) return;
    setResolving(true);
    setError(null);
    try {
      const result = await resolveGuideLogin({ email: user.email });
      if (result.success && result.route) {
        if (result.userData) {
          forceSetProfile(result.userData);
        }
        navigate(result.route, { replace: true });
      } else {
        setError(result.message || 'Guide access not found for this account.');
      }
    } catch (err) {
      console.error('[GuideLoginPage] Guide login resolution failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to verify guide access. Please try again.');
    } finally {
      setResolving(false);
    }
  };

  // Only show full-page loading on the very first auth check (not on tab refocus)
  if ((isLoading && !initialLoadDone.current) || resolving) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
            </div>
            <CardTitle>{resolving ? 'Verifying Guide Access…' : 'Loading…'}</CardTitle>
            <CardDescription>Please wait while we authenticate your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <XCircle className="w-16 h-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl text-center">Access Denied</CardTitle>
            <CardDescription className="text-center">Guide access not found for this account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2">
              <Button className="w-full" onClick={() => {
                setError(null);
                hasAttemptedRef.current = false;
                handleGuideLoginResolution();
              }}>
                Try Again
              </Button>
              <Button variant="outline" className="w-full" onClick={() => logout({ returnTo: window.location.origin })}>
                Logout &amp; Try Different Account
              </Button>
              <Button variant="link" className="w-full" onClick={() => navigate('/')}>
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not authenticated — show login button
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <Users className="w-16 h-16 text-primary" />
          </div>
          <CardTitle className="text-2xl text-center">Guide / Admin Login</CardTitle>
          <CardDescription className="text-center">For FOLK Guides and Super Guides only</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Restricted Access</AlertTitle>
            <AlertDescription>
              This portal is for registered FOLK Guides and Super Guides. Regular devotees should use the Devotee Login.
            </AlertDescription>
          </Alert>
          <Button
            className="w-full"
            size="lg"
            onClick={() => loginWithRedirect({ redirectUrl: `${window.location.origin}/guide-login` })}
          >
            Login as Guide / Admin
          </Button>
          <Button variant="link" className="w-full" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
