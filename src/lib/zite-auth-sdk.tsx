"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  connectAuthEmulator,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  User as FirebaseUser
} from 'firebase/auth';

// ══════════════════════════════════════════════════════════════════════════════
// zite-auth-sdk.tsx — Firebase Auth integration with Google sign-in & Email Links.
// Uses signInWithPopup and sendSignInLinkToEmail in production.
// Mock auth via localStorage for local dev/testing fallback.
// ══════════════════════════════════════════════════════════════════════════════

interface AuthContextType {
  user: { email: string | null; id: string | null } | null;
  isLoading: boolean;
  loginWithRedirect: (options?: { redirectUrl?: string }) => Promise<void>;
  sendVerificationEmail: (email: string, redirectUrl?: string) => Promise<boolean>;
  logout: (options?: { returnTo?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Initialize Firebase if config exists in env
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const isFirebaseEnabled = !!firebaseConfig.apiKey;
// True when using the local Firebase Auth emulator (set in .env.local only — never in production)
const isEmulatorMode = process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === 'true';

let app: any;
let auth: any;
let _authEmulatorConnected = false;
if (isFirebaseEnabled) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
  // Connect to local Auth emulator when NEXT_PUBLIC_USE_AUTH_EMULATOR=true (local dev only)
  if (isEmulatorMode && !_authEmulatorConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: false });
    _authEmulatorConnected = true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ email: string | null; id: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check URL parameters & Firebase Auth email link verification callback
    if (typeof window !== 'undefined') {
      if (isFirebaseEnabled && auth && isSignInWithEmailLink(auth, window.location.href)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
          const searchParams = new URLSearchParams(window.location.search);
          email = searchParams.get('email');
        }
        if (email) {
          setIsLoading(true);
          signInWithEmailLink(auth, email, window.location.href)
            .then(async (result) => {
              window.localStorage.removeItem('emailForSignIn');
              const token = await result.user.getIdToken();
              (window as any).__firebase_id_token = token;
              localStorage.setItem('auth_email', email!);
              setUser({ email: result.user.email || email, id: result.user.uid });
              setIsLoading(false);
            })
            .catch((err) => {
              console.error('[Firebase Auth] Email link sign in error:', err);
              setIsLoading(false);
            });
          return;
        }
      }

      const searchParams = new URLSearchParams(window.location.search);
      const urlEmail = searchParams.get('email');
      const isVerified = searchParams.get('verified') === 'true';

      if (urlEmail && isVerified) {
        localStorage.setItem('auth_email', urlEmail);
        localStorage.setItem('auth_mock_mode', 'true');
        (window as any).__firebase_id_token = `mock_token_for_${urlEmail}`;
        setUser({ email: urlEmail, id: urlEmail });
        setIsLoading(false);
        return;
      }
    }

    const isMockMode = typeof window !== 'undefined' && (
      localStorage.getItem('auth_mock_mode') === 'true' ||
      (window as any).__firebase_id_token?.startsWith('mock_token_for_')
    );

    if (isFirebaseEnabled && auth && !isMockMode) {
      return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
        setIsLoading(true);
        if (fbUser) {
          const token = await fbUser.getIdToken();
          if (typeof window !== 'undefined') {
            (window as any).__firebase_id_token = token;
            localStorage.setItem('auth_email', fbUser.email || '');
          }
          setUser({ email: fbUser.email, id: fbUser.uid });
        } else {
          if (typeof window !== 'undefined') {
            delete (window as any).__firebase_id_token;
            localStorage.removeItem('auth_email');
          }
          setUser(null);
        }
        setIsLoading(false);
      });
    } else {
      // Mock Auth Fallback
      if (typeof window !== 'undefined') {
        const storedEmail = localStorage.getItem('auth_email');
        if (storedEmail) {
          setUser({ email: storedEmail, id: storedEmail });
          (window as any).__firebase_id_token = `mock_token_for_${storedEmail}`;
        } else {
          setUser(null);
        }
      }
      setIsLoading(false);
    }
  }, []);

  const sendVerificationEmail = async (emailToVerify: string, customRedirect?: string) => {
    const targetUrl = customRedirect || `${window.location.origin}/zite-auth`;

    if (isFirebaseEnabled && auth) {
      try {
        const actionCodeSettings = {
          url: `${targetUrl}?verified=true&email=${encodeURIComponent(emailToVerify)}`,
          handleCodeInApp: true,
        };
        await sendSignInLinkToEmail(auth, emailToVerify, actionCodeSettings);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('emailForSignIn', emailToVerify);
        }
      } catch (err) {
        console.warn('[Firebase Auth] sendSignInLinkToEmail warning:', err);
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('pending_verification_email', emailToVerify);
    }
    return true;
  };

  const loginWithRedirect = async (options?: { redirectUrl?: string }) => {
    if (isFirebaseEnabled && auth) {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      if (options?.redirectUrl) {
        window.location.href = options.redirectUrl;
      }
    } else {
      const redirectUrl = options?.redirectUrl || `${window.location.origin}/zite-auth`;
      window.location.href = `/login?redirectUrl=${encodeURIComponent(redirectUrl)}`;
    }
  };

  const logout = async (options?: { returnTo?: string }) => {
    if (isFirebaseEnabled && auth) {
      await signOut(auth);
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_email');
      localStorage.removeItem('auth_mock_mode');
      localStorage.removeItem('pending_verification_email');
      delete (window as any).__firebase_id_token;
    }
    setUser(null);
    if (options?.returnTo) {
      window.location.href = options.returnTo;
    } else {
      window.location.reload();
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, loginWithRedirect, sendVerificationEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
