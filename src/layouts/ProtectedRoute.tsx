import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
}

/**
 * Role access check:
 * - BVSL is a flag (isBvsl) OR a role ('BVSL')
 * - Sadhana Mentor is a flag (isSadhanaMentor) OR a role ('SADHANA_MENTOR')
 * - BV Mentor is a flag (isBvMentor) — has access to BV_MENTOR routes
 */
function hasAccess(
  role: string,
  isBvsl: boolean,
  isSadhanaMentor: boolean,
  isServiceAllocator: boolean,
  isBvMentor: boolean,
  allowedRoles: string[],
): boolean {
  if (allowedRoles.includes(role)) return true;
  if (isBvsl && allowedRoles.includes('BVSL')) return true;
  if (isSadhanaMentor && allowedRoles.includes('SADHANA_MENTOR')) return true;
  if (isServiceAllocator && allowedRoles.includes('SERVICE_ALLOCATOR')) return true;
  if (isBvMentor && allowedRoles.includes('BV_MENTOR')) return true;
  return false;
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const { profile, isLoading: profileLoading, profileError } = useUserProfile();

  useEffect(() => {
    if (!authLoading && !user) {
      loginWithRedirect({ redirectUrl: window.location.href });
    }
  }, [authLoading, user]);

  if (authLoading || profileLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-32" />
        <p className="text-xs text-muted-foreground mt-1">Loading your profile…</p>
      </div>
    </div>
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">Session expired — redirecting to sign in…</p>
        </div>
      </div>
    );
  }

  if (profileError) return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center max-w-sm space-y-4">
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <span className="text-2xl">⚠️</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-1">Could Not Load Profile</h2>
          <p className="text-muted-foreground text-sm">{profileError}</p>
        </div>
        <button
          className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
        <p className="text-xs text-muted-foreground">If this keeps happening, check your internet connection</p>
      </div>
    </div>
  );

  if (!profile) return <Navigate to="/register" replace />;
  if (profile.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
  if (profile.status === 'REJECTED') return <Navigate to="/rejected" replace />;

  if (allowedRoles && !hasAccess(
    profile.role,
    profile.isBvsl,
    profile.isSadhanaMentor,
    profile.isServiceAllocator ?? false,
    profile.isBvMentor ?? false,
    allowedRoles,
  )) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
