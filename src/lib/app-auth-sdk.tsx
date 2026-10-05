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
  User as FirebaseUser
} from 'firebase/auth';
import { getDepartmentLandingUrl } from '@/lib/userDashboardRoutes';

// ══════════════════════════════════════════════════════════════════════════════
// app-auth-sdk.tsx — Firebase Auth integration with Google sign-in.
// Uses signInWithPopup in both emulator and production.
// This works reliably across different hosting domains without falling prey
// to browser third-party cookie restrictions during redirect.
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
const isEmulatorMode = process.env.NODE_ENV !== 'production'
  && process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === 'true';

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
    if (isFirebaseEnabled && auth) {
      return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
        setIsLoading(true);
        if (fbUser) {
          const token = await fbUser.getIdToken();
          // Store token globally for API endpoints to read
          if (typeof window !== 'undefined') {
            (window as any).__firebase_id_token = token;
            localStorage.setItem('auth_email', fbUser.email || '');
            localStorage.setItem('auth_user_id', fbUser.uid || '');
            window.dispatchEvent(new Event('authStateChanged'));
          }
          setUser({ email: fbUser.email, id: fbUser.uid });
        } else {
          if (typeof window !== 'undefined') {
            delete (window as any).__firebase_id_token;
            localStorage.removeItem('auth_email');
            localStorage.removeItem('auth_user_id');
            window.dispatchEvent(new Event('authStateChanged'));
          }
          setUser(null);
        }
        setIsLoading(false);
      });
    } else {
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  const loginWithRedirect = async (options?: { redirectUrl?: string }) => {
    if (isFirebaseEnabled && auth) {
      const provider = new GoogleAuthProvider();
      // Use signInWithPopup in both Emulator and Production.
      // This works reliably across different hosting domains.
      await signInWithPopup(auth, provider);
      if (options?.redirectUrl) {
        window.location.href = options.redirectUrl;
      }
    } else {
      throw new Error('Sign-in is unavailable because Firebase is not configured.');
    }
  };

  const logout = async (options?: { returnTo?: string }) => {
    if (isFirebaseEnabled && auth) {
      await signOut(auth);
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_email');
      localStorage.removeItem('auth_mock_mode');
      localStorage.removeItem('auth_profile_email');
      delete (window as any).__firebase_id_token;
    }
    setUser(null);
    if (typeof window !== 'undefined') {
      // Do not reload a protected dashboard after logout. That leaves the
      // route waiting for authentication and produces the perpetual spinner.
      window.location.replace(options?.returnTo || getDepartmentLandingUrl());
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

export { auth };
export const firebaseApp = app;
