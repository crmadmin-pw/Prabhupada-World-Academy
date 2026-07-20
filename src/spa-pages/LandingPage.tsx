import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { useEffect, useState } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PWA_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  useEffect(() => {
    if (user) navigate('/zite-auth', { replace: true });
  }, [user, navigate]);

  const handleSignIn = async () => {
    setAuthError(null);
    setAuthenticating(true);
    try {
      await loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` });
    } catch (err: any) {
      console.error('[LandingPage] Sign in failed:', err);
      setAuthError(err?.message || 'Authentication failed. Please check your browser popup settings.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleRegister = async () => {
    setAuthError(null);
    setAuthenticating(true);
    try {
      await loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` });
    } catch (err: any) {
      console.error('[LandingPage] Registration failed:', err);
      setAuthError(err?.message || 'Registration failed. Please check your browser popup settings.');
    } finally {
      setAuthenticating(false);
    }
  };

  if (isLoading || authenticating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-2">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
        <span className="text-sm text-muted-foreground">Connecting to Google Auth...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-8">

        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-3">
          <img
            src={PWA_LOGO}
            alt="Prabhupada World Academy"
            className="w-24 h-24 object-contain"
          />
          <div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              Prabhupada World Academy
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Daily Spiritual Practice Tracker</p>
          </div>
        </div>

        {authError && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg border border-destructive/20 text-left">
            <strong>Authentication Error:</strong> {authError}
          </div>
        )}

        {/* Buttons */}
        <div className="space-y-3">
          {/* Sign In — existing users */}
          <Button
            className="w-full shadow-md font-semibold"
            size="lg"
            onClick={handleSignIn}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>

          {/* Register — new users */}
          <Button
            className="w-full shadow-md font-semibold"
            size="lg"
            variant="outline"
            onClick={handleRegister}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Register
          </Button>

          <p className="text-xs text-muted-foreground">
            New users will be guided through registration after signing in.
          </p>
        </div>

      </div>
    </div>
  );
}
