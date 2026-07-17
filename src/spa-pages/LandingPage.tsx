import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { useEffect } from 'react';
import { Loader2, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PWA_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

const REGISTER_URL =
  'https://build.fillout.com/auth?flowPublicIdentifier=u91plgmzcu&redirectUrl=https%3A%2F%2Fpwac.zite.so%2Fzite-auth&mode=signup';

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect } = useAuth();

  const isFirebaseEnabled = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

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
          <Button
            className="w-full shadow-md"
            size="lg"
            onClick={() => loginWithRedirect({ redirectUrl: `${window.location.origin}/zite-auth` })}
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>

          <Button
            className="w-full shadow-md"
            size="lg"
            variant="outline"
            onClick={() => {
              if (isFirebaseEnabled) {
                window.location.href = REGISTER_URL;
              } else {
                navigate('/signup');
              }
            }}
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Register
          </Button>

          <p className="text-xs text-muted-foreground">
            Sign in with your existing account, or register to create a new one.
          </p>
        </div>

      </div>
    </div>
  );
}
