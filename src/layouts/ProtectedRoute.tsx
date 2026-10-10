import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { readAccountLinkHold } from '@/lib/accountLinkHold';
import { getDepartmentLandingUrl } from '@/lib/userDashboardRoutes';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface Props {
  children: React.ReactNode;
  allowedRoles?: string[];
}

/**
 * Hierarchy Role access check:
 *
 * BV Hierarchy (highest → lowest):
 *   Super Admin → Admin → Supervisor (BV_MENTOR) → RGF (BVSL/isBvFacilitator) → RGSF (isBvSubFacilitator, base role: User)
 *
 * Access rules per route:
 *   - BV_MENTOR routes: Supervisors (isBvMentor | isBvSupervisor), Guides, Admins
 *   - BVSL routes: RGFs (isBvsl | isBvFacilitator), Sadhana Mentors, Guides
 *   - USER routes: Any approved user (includes RGSFs whose base role is 'User')
 */
function hasAccess(
  role: string,
  isBvsl: boolean,
  isSadhanaMentor: boolean,
  isServiceAllocator: boolean,
  isBvMentor: boolean,
  isBvAdmin: boolean,
  isBvSuperAdmin: boolean,
  allowedRoles: string[],
  isBvSupervisor?: boolean,
  isBvFacilitator?: boolean,
  isBvSubFacilitator?: boolean,
): boolean {
  const normRole = (role || '').toUpperCase();
  const normAllowed = allowedRoles.map(r => r.toUpperCase());

  if (normAllowed.includes(normRole)) return true;
  // USER routes — any approved member (note: /rgsf/dashboard uses this since RGSF base role is 'User')
  if (normAllowed.includes('USER')) return true;
  // Admin-tier access
  if ((isBvAdmin || isBvSuperAdmin || normRole === 'ADMIN' || normRole === 'SUPER_ADMIN') &&
      (normAllowed.includes('SUPER_ADMIN') || normAllowed.includes('SUPER_GUIDE') || normAllowed.includes('ADMIN') || normAllowed.includes('PW_ADMIN'))) {
    return true;
  }
  // RGF (Facilitator) access — isBvsl (legacy) OR isBvFacilitator (new)
  if ((isBvsl || isBvFacilitator) && normAllowed.includes('BVSL')) return true;
  if (isBvSubFacilitator && (normAllowed.includes('RGSF') || normAllowed.includes('SUB_FACILITATOR'))) return true;
  if (isSadhanaMentor && normAllowed.includes('SADHANA_MENTOR')) return true;
  if (isServiceAllocator && normAllowed.includes('SERVICE_ALLOCATOR')) return true;
  // Supervisor access — isBvMentor (legacy) OR isBvSupervisor (new)
  if ((isBvMentor || isBvSupervisor) && normAllowed.includes('BV_MENTOR')) return true;
  // RGSFs do NOT get Supervisor (BV_MENTOR) or RGF (BVSL) dashboard access.
  return false;
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, isLoading: authLoading } = useAuth();
  const { profile, isLoading: profileLoading, profileError } = useUserProfile();

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.replace(getDepartmentLandingUrl());
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

  if (!profile) return <Navigate to={readAccountLinkHold() ? '/account-link-pending' : '/register'} replace />;
  if (profile.status === 'PENDING_DELETION') return <Navigate to="/account-deletion" replace />;
  if (profile.status === 'PENDING_APPROVAL') return <Navigate to="/pending" replace />;
  if (profile.status === 'REJECTED') return <Navigate to="/rejected" replace />;

  if (allowedRoles && !hasAccess(
    profile.role,
    profile.isBvsl,
    profile.isSadhanaMentor,
    profile.isServiceAllocator ?? false,
    profile.isBvMentor ?? false,
    profile.isBvAdmin ?? false,
    profile.isBvSuperAdmin ?? false,
    allowedRoles,
    (profile as any).isBvSupervisor ?? false,
    (profile as any).isBvFacilitator ?? false,
    (profile as any).isBvSubFacilitator ?? false,
  )) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
