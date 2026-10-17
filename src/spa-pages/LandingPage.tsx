import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { authCallbackPath, rememberRegistrationDepartment } from '@/lib/registrationDepartment';

const PWA_LOGO = '/logo-mark.webp';

export default function LandingPage({ isPw = false }: { isPw?: boolean }) {
  const navigate = useNavigate();
  const { user, isLoading, loginWithRedirect, logout } = useAuth();
  const { profile, isLoading: profileLoading } = useUserProfile();
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const canCreateNewPwAccount = isPw && !profileLoading && profile?.status === 'REJECTED';

  const department = isPw ? 'PW' : 'FOLK';
  if (typeof window !== 'undefined') rememberRegistrationDepartment(department);

  useEffect(() => {
    if (user && !profileLoading && !canCreateNewPwAccount) navigate(authCallbackPath(department), { replace: true });
  }, [user, profileLoading, canCreateNewPwAccount, navigate, department]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setSigningIn(true);
    rememberRegistrationDepartment(department);
    try {
      const redirectUrl = `${window.location.origin}${authCallbackPath(department)}`;
      await loginWithRedirect({ redirectUrl });
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with Google');
      setSigningIn(false);
    }
  };

  const handleCreateNewAccount = async () => {
    setError(null);
    await logout({ returnTo: isPw ? '/pw' : '/' });
  };

  if (isLoading || signingIn || (user && profileLoading)) {
    return (
      <div className="min-h-screen bg-[#fefdfa] flex flex-col items-center justify-center gap-2.5" role="status">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" aria-hidden="true" />
        <span className="text-sm text-gray-500 font-medium">Connecting to Google Auth...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#fefdfa] flex items-center justify-center p-4">
      <div className="w-full max-w-[400px] text-center space-y-8">

        {/* Logo / Brand */}
        <div className="flex flex-col items-center gap-4">
          <img
            src={PWA_LOGO}
            alt="Prabhupada World Academy Logo"
            width={112}
            height={112}
            fetchPriority="high"
            className="w-28 h-28 object-contain"
          />
          <div>
            <h1 className="text-[28px] font-bold text-gray-900 tracking-tight leading-tight">
              Prabhupada World Academy
            </h1>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{ opacity: 1, height: 'auto', scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5 text-left text-xs text-red-600">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buttons / Actions */}
        <div className="space-y-4">
          {canCreateNewPwAccount && (
            <div className="rounded-lg border border-orange-100 bg-orange-50 p-3 text-sm text-orange-800">
              Your previous registration was rejected. Sign out to create another Prabhupada World account.
            </div>
          )}
          <motion.button
            type="button"
            whileHover={{ scale: 1.01, backgroundColor: "#f9fafb" }}
            whileTap={{ scale: 0.99 }}
            onClick={canCreateNewPwAccount ? handleCreateNewAccount : handleGoogleSignIn}
            className="w-full h-11 bg-white border border-gray-300 text-gray-700 font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center gap-2 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {canCreateNewPwAccount ? 'Create another account' : 'Continue with Google'}
          </motion.button>

          <p className="text-xs text-gray-500 font-medium">
            New users will be guided through registration.
          </p>
        </div>

      </div>
    </div>
  );
}
