import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

export default function LoginPage({ mode = 'signin', isPw = false }: { mode?: 'signin' | 'signup', isPw?: boolean }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loginWithRedirect } = useAuth();
  const { profile } = useUserProfile();
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Set or remove local storage flow flag on mount / prop change
  useEffect(() => {
    if (isPw) {
      localStorage.setItem('pwa_is_pw_flow', 'true');
    } else {
      localStorage.removeItem('pwa_is_pw_flow');
    }
  }, [isPw]);

  // Redirect users who are already authenticated
  useEffect(() => {
    if (user) {
      if (!profile) {
        navigate('/register');
      } else if (profile.status === 'ACTIVE') {
        navigate('/dashboard');
      } else if (profile.status === 'PENDING_APPROVAL') {
        navigate('/pending');
      } else if (profile.status === 'REJECTED') {
        navigate('/rejected');
      } else if (profile.status === 'PENDING_DELETION') {
        navigate('/account-deletion');
      }
    }
  }, [user, profile, navigate]);

  // Get the redirectUrl from query parameters, default to /auth-callback
  const redirectUrl = searchParams.get('redirectUrl') || `${window.location.origin}/auth-callback`;

  return (
    <div className="min-h-dvh w-full bg-[#fefdfa] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[440px] bg-white border border-gray-200/80 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.05),_0_1px_6px_rgba(0,0,0,0.02)] p-5 sm:p-8 md:p-10 text-center"
      >
        
        {/* Title */}
        <motion.h1 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-3xl font-bold text-gray-900 tracking-tight mb-2"
        >
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </motion.h1>
        
        <motion.p 
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="text-xs text-gray-500 mb-6"
        >
          Sign in securely using your Google account to access your dashboard.
        </motion.p>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0, scale: 0.95 }}
              animate={{ opacity: 1, height: 'auto', scale: 1 }}
              exit={{ opacity: 0, height: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden mb-6"
            >
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5 text-left text-xs text-red-600">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4 text-left mt-6"
        >
          <motion.button
            type="button"
            whileHover={{ scale: 1.01, backgroundColor: "#f9fafb" }}
            whileTap={{ scale: 0.99 }}
            onClick={async () => {
              setError(null);
              setLoading(true);
              try {
                await loginWithRedirect({ redirectUrl });
              } catch (err: any) {
                setError(err?.message || 'Failed to sign in with Google');
                setLoading(false);
              }
            }}
            disabled={loading}
            className="w-full h-11 bg-white border border-gray-300 text-gray-700 font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {loading ? 'Continuing...' : 'Continue with Google'}
          </motion.button>
        </motion.div>

        {/* Footer Link */}
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="text-sm text-gray-500 mt-6"
        >
          {mode === 'signin' ? (
            <>
              Don't have an account? 
              <span 
                onClick={() => navigate(isPw ? '/pw/signup' : '/signup')}
                className="text-gray-950 hover:text-black font-semibold ml-1 cursor-pointer transition-colors"
              >
                Sign up
              </span>
            </>
          ) : (
            <>
              Already have an account? 
              <span 
                onClick={() => navigate(isPw ? '/pw' : '/login')}
                className="text-gray-950 hover:text-black font-semibold ml-1 cursor-pointer transition-colors"
              >
                Sign in
              </span>
            </>
          )}
        </motion.p>

      </motion.div>
    </div>
  );
}
