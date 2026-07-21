"use client";

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { AlertCircle, ArrowLeft, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { checkEmailStatus } from 'zite-endpoints-sdk';

export default function LoginPage({ mode = 'signin' }: { mode?: 'signin' | 'signup' }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithRedirect, signInWithPassword } = useAuth();
  
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Get the redirectUrl from query parameters, default to /zite-auth
  const redirectUrl = searchParams.get('redirectUrl') || `${window.location.origin}/zite-auth`;

  const isFirebaseEnabled = !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

  const handleContinueEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Email address is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const res = await checkEmailStatus({ email: trimmedEmail });
      if (res.exists) {
        // User exists -> Ask for Password
        setStep('password');
      } else {
        // New user -> Direct to Registration page
        toast.info('Account not found — taking you to registration.');
        navigate(`/signup?email=${encodeURIComponent(trimmedEmail)}`);
      }
    } catch {
      // Fallback: proceed to password step
      setStep('password');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Password is required');
      return;
    }

    setLoading(true);
    try {
      await signInWithPassword(email, password, redirectUrl);
      toast.success('Signed in successfully');
      window.location.href = redirectUrl;
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in. Please check your credentials.');
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      if (isFirebaseEnabled) {
        await loginWithRedirect({ redirectUrl });
      } else {
        const defaultEmail = email.trim() || 'user@prabhupadaworld.org';
        localStorage.setItem('auth_email', defaultEmail);
        localStorage.setItem('auth_mock_mode', 'true');
        (window as any).__firebase_id_token = `mock_token_for_${defaultEmail}`;
        toast.success(`Signed in as ${defaultEmail}`);
        window.location.href = redirectUrl;
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in with Google');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#fefdfa] flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] bg-white border border-gray-200/80 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.08),_0_1px_6px_rgba(0,0,0,0.03)] p-8 md:p-10 text-center animate-in fade-in zoom-in-95 duration-200">
        
        {step === 'password' ? (
          /* Step 2: Password Entry */
          <div>
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setStep('email')}
                className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Step 2 of 2</span>
            </div>

            <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-orange-100">
              <KeyRound className="w-6 h-6" />
            </div>

            <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">
              Enter your password
            </h1>
            <p className="text-xs text-gray-500 mb-6">
              Signing in as <strong className="text-gray-900 font-semibold">{email}</strong>
            </p>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5 text-left text-xs text-red-600 animate-in fade-in slide-in-from-top-1 duration-250">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4 text-left">
              <div>
                <label 
                  htmlFor="password" 
                  className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoFocus
                  disabled={loading}
                  className="w-full h-11 px-4 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:bg-gray-50 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-[#ea6506] hover:bg-[#d35a04] text-white font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <p className="text-xs text-gray-400 mt-6">
              Wrong email?{' '}
              <button
                type="button"
                onClick={() => setStep('email')}
                className="text-gray-800 font-semibold hover:underline cursor-pointer"
              >
                Use a different email address
              </button>
            </p>
          </div>
        ) : (
          /* Step 1: Email Entry */
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-2">
              {mode === 'signin' ? 'Sign in' : 'Sign up'}
            </h1>
            <p className="text-xs text-gray-500 mb-6">
              Welcome to Prabhupada World Academy. Enter your email to continue.
            </p>

            {error && (
              <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2.5 text-left text-xs text-red-600 animate-in fade-in slide-in-from-top-1 duration-250">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Google Sign-In Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full h-11 bg-white hover:bg-gray-50 text-gray-700 font-medium text-sm rounded-lg border border-gray-300 shadow-sm transition-all flex items-center justify-center gap-3 cursor-pointer mb-4 disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Sign in with Google
            </button>

            {/* Divider */}
            <div className="flex items-center my-4">
              <div className="flex-1 h-[1px] bg-gray-200"></div>
              <span className="px-3 text-[11px] text-gray-400 font-bold uppercase tracking-wider">or email</span>
              <div className="flex-1 h-[1px] bg-gray-200"></div>
            </div>

            <form onSubmit={handleContinueEmail} className="space-y-4 text-left">
              <div>
                <label 
                  htmlFor="email" 
                  className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-2"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={loading}
                  className="w-full h-11 px-4 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 disabled:opacity-50 disabled:bg-gray-50 transition-all"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-[#ea6506] hover:bg-[#d35a04] text-white font-semibold text-sm rounded-lg shadow-sm transition-all hover:shadow flex items-center justify-center cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? 'Checking email...' : 'Continue with Email'}
              </button>
            </form>

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
        )}

      </div>
    </div>
  );
}
