"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  connectAuthEmulator,
  User as FirebaseUser
} from 'firebase/auth';

// ══════════════════════════════════════════════════════════════════════════════
// zite-auth-sdk.tsx — Firebase Auth integration with Google sign-in.
// Uses signInWithRedirect for production (works on all browsers + mobile).
// Falls back to signInWithPopup only in local emulator mode.
// Mock auth via localStorage for local dev/testing.
// ══════════════════════════════════════════════════════════════════════════════

interface AuthContextType {
  user: { email: string | null; id: string | null } | null;
  isLoading: boolean;
  loginWithRedirect: (options?: { redirectUrl?: string }) => Promise<void>;
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
    const isMockMode = typeof window !== 'undefined' && (
      localStorage.getItem('auth_mock_mode') === 'true' ||
      (window as any).__firebase_id_token?.startsWith('mock_token_for_')
    );

    if (isFirebaseEnabled && auth && !isMockMode) {
      // Handle the redirect result on page load (fires after signInWithRedirect returns the user)
      getRedirectResult(auth)
        .then((result) => {
          if (result?.user) {
            // Redirect result processed — onAuthStateChanged will fire and set state
            // Navigate to the intended URL if stored
            if (typeof window !== 'undefined') {
              const redirectUrl = sessionStorage.getItem('auth_redirect_url');
              if (redirectUrl) {
                sessionStorage.removeItem('auth_redirect_url');
                window.location.href = redirectUrl;
              }
            }
          }
        })
        .catch((err) => {
          console.error('[Auth] getRedirectResult error:', err?.code, err?.message);
        });

      return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
        setIsLoading(true);
        if (fbUser) {
          const token = await fbUser.getIdToken();
          // Store token globally for API endpoints to read
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
      // Mock Auth Fallback (local dev / testing)
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

  const loginWithRedirect = async (options?: { redirectUrl?: string }) => {
    if (isFirebaseEnabled && auth) {
      const provider = new GoogleAuthProvider();
      // Store the intended redirect URL so we can navigate there after the auth redirect returns
      if (options?.redirectUrl && typeof window !== 'undefined') {
        sessionStorage.setItem('auth_redirect_url', options.redirectUrl);
      }
      if (isEmulatorMode) {
        // Local emulator: use popup (emulator handles it without real Google OAuth)
        await signInWithPopup(auth, provider);
        if (options?.redirectUrl) window.location.href = options.redirectUrl;
      } else {
        // Production: use redirect — works on all browsers including mobile,
        // no popup-blocking issues. Google handles auth then redirects back here.
        await signInWithRedirect(auth, provider);
      }
    } else {
      // Mock mode: go to local login page
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
      sessionStorage.removeItem('auth_redirect_url');
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
    <AuthContext.Provider value={{ user, isLoading, loginWithRedirect, logout }}>
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
