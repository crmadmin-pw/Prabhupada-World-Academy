"use client";

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage({ mode = 'signin' }: { mode?: 'signin' | 'signup' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithRedirect } = useAuth();
  
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Get the redirectUrl from query parameters, default to /zite-auth
  const redirectUrl = searchParams.get('redirectUrl') || `${window.location.origin}/zite-auth`;

  const isFirebaseEnabled = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email address is required');
      return;
    }

    // Basic email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      // Set email token for local session — passwordless instant login
      localStorage.setItem('auth_email', trimmedEmail);
      localStorage.setItem('auth_mock_mode', 'true');
      (window as any).__firebase_id_token = `mock_token_for_${trimmedEmail}`;
      
      toast.success(mode === 'signin' ? `Logged in as ${trimmedEmail}` : `Signed up as ${trimmedEmail}`);
      window.location.href = redirectUrl;
    } catch (err: any) {
      setError(err?.message || 'An error occurred during sign in');
      setLoading(false);
    }
  };

  const handleQuickLogin = (emailToUse: string) => {
    setError(null);
    setLoading(true);
    localStorage.setItem('auth_email', emailToUse);
    localStorage.setItem('auth_mock_mode', 'true');
    (window as any).__firebase_id_token = `mock_token_for_${emailToUse}`;
    toast.success(`Logged in as ${emailToUse}`);
    window.location.href = redirectUrl;
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    const trimmedEmail = email.trim();
    if (trimmedEmail) {
      handleQuickLogin(trimmedEmail);
      return;
    }

    // Default to Super Guide if no email entered
    handleQuickLogin('superguide@gmail.com');
  };

  return (
    <div className="min-h-screen w-full bg-[#fefdfa] flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] bg-white border border-gray-200/80 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.08),_0_1px_6px_rgba(0,0,0,0.03)] p-8 md:p-10 text-center">
        
        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-2">
          {mode === 'signin' ? 'Sign in' : 'Sign up'}
        </h1>
        <p className="text-xs text-gray-500 mb-6">
          Enter any test email to log in instantly — no password required.
        </p>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5 text-left text-xs text-red-600 animate-in fade-in slide-in-from-top-1 duration-250">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4 text-left mt-6">
          <button
            type="button"
            onClick={async () => {
              setLoading(true);
              try {
                await loginWithRedirect({ redirectUrl });
              } catch (err: any) {
                setError(err?.message || 'Failed to sign in with Google');
                setLoading(false);
              }
            }}
            disabled={loading}
            className="w-full h-11 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {loading ? 'Continuing...' : 'Continue with Google'}
          </button>
        </div>

        {!isFirebaseEnabled && (
          <>
            {/* Divider */}
            <div className="flex items-center my-5">
              <div className="flex-1 h-[1px] bg-gray-100"></div>
              <span className="px-3 text-[11px] text-gray-400 font-bold uppercase tracking-wider">or local dev mock</span>
              <div className="flex-1 h-[1px] bg-gray-100"></div>
            </div>

            <form onSubmit={handleContinue} className="space-y-4 text-left">
              <div>
                <label 
                  htmlFor="email" 
                  className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2"
                >
                  Mock Email address
                </label>
                <input
                  id="email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. superguide@gmail.com"
                  disabled={loading}
                  className="w-full h-11 px-4 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:bg-gray-50 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-gray-900 hover:bg-black text-white font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? 'Continuing...' : 'Mock Login (Dev Only)'}
              </button>
            </form>
          </>
        )}

        {/* Footer Link */}
        <p className="text-sm text-gray-500 mt-6">
          {mode === 'signin' ? (
            <>
              Don't have an account? 
              <span 
                onClick={() => navigate('/signup')}
                className="text-gray-950 hover:text-black font-semibold ml-1 cursor-pointer transition-colors"
              >
                Sign up
              </span>
            </>
          ) : (
            <>
              Already have an account? 
              <span 
                onClick={() => navigate('/login')}
                className="text-gray-950 hover:text-black font-semibold ml-1 cursor-pointer transition-colors"
              >
                Sign in
              </span>
            </>
          )}
        </p>

      </div>
    </div>
  );
}

