"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';

// ══════════════════════════════════════════════════════════════════════════════
// zite-auth-sdk.tsx — Compatibility layer for Zite auth SDK.
// Integrates with Firebase Auth on client side, with local Mock fallback.
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

let app;
let auth: any;
if (isFirebaseEnabled) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  auth = getAuth(app);
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
      return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
        setIsLoading(true);
        if (fbUser) {
          const token = await fbUser.getIdToken();
          // Store token globally for endpoints to read
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

  const loginWithRedirect = async (options?: { redirectUrl?: string }) => {
    if (isFirebaseEnabled && auth) {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      if (options?.redirectUrl) {
        window.location.href = options.redirectUrl;
      }
    } else {
      // Redirect to custom local login page
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
