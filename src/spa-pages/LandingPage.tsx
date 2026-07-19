import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { useEffect } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PWA_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect } = useAuth();

  useEffect(() => {
    if (user) navigate('/zite-auth', { replace: true });
  }, [user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
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

        {/* Buttons */}
        <div className="space-y-3">
          {/* Sign In — existing users */}
          <Button
            className="w-full shadow-md"
            size="lg"
            onClick={() => loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` })}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In with Google
          </Button>

          {/* Register — new users: authenticate first, then fill the registration form */}
          <Button
            className="w-full shadow-md"
            size="lg"
            variant="outline"
            onClick={() => loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` })}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Register
          </Button>

          <p className="text-xs text-muted-foreground">
            Sign in with your Google account. New users will be guided through registration after signing in.
          </p>
        </div>

      </div>
    </div>
  );
}
