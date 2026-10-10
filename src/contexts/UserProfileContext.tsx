import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-sdk';
import { getUserProfile, updateLastLogin } from '@/lib/endpoints-sdk';
import type { ProfileSummary } from '@/types/models';
import type { UserStatus } from '@/types/enums';
import { toast } from 'sonner';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { getDepartmentLandingUrl, getUserDepartment, rememberUserDepartment } from '@/lib/userDashboardRoutes';

// Re-export for backward compatibility — NEW CODE should import from '@/types/models'
export type ProfileData = ProfileSummary | null;

type ProfileCtx = {
  profile: ProfileData;
  isLoading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<ProfileData>;
  /** Directly set profile from known user data (used by login resolution pages) */
  forceSetProfile: (userData: any) => void;
};

const Ctx = createContext<ProfileCtx>({
  profile: null,
  isLoading: true,
  profileError: null,
  refreshProfile: async () => null,
  forceSetProfile: () => { },
});

// BUG-1 FIX: role is USER | GUIDE | SUPER_GUIDE only.
// BVSL and Sadhana Mentor are flags (isBvsl, isSadhanaMentor), not roles.
function buildProfile(userObj: any): ProfileData {
  if (!userObj) return null;

  const residencyId = Array.isArray(userObj.residency) ? userObj.residency[0] : userObj.residency;
  const selectedFolkResidency = userObj.selectedFolkResidency ?? residencyId ?? null;
  const isResident = !!(
    (userObj.residencyApproved || userObj.residencyGuideVerified) &&
    selectedFolkResidency
  );

  let rawRole = ((userObj.role as string) || 'USER').toUpperCase().replace(/\s+/g, '_').trim();
  // Normalize legacy variants
  if (rawRole === 'SUPERADMIN') rawRole = 'SUPER_ADMIN';
  const validRoles = ['USER', 'GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'BVSL', 'SADHANA_MENTOR'];
  const role = validRoles.includes(rawRole) ? rawRole : 'USER';

  const isBvsl = !!(userObj.isBvsl || role === 'BVSL');
  const isSadhanaMentor = !!(userObj.isSadhanaMentor || role === 'SADHANA_MENTOR');
  const isServiceAllocator = !!(userObj.isServiceAllocator);
  const isBvMentor = !!(userObj.isBvMentor);
  const isCleanlinessManager = !!(userObj.isCleanlinessManager);
  const folkResidencyCustomId = userObj.folkResidencyCustomId ?? null;

  // BV Hierarchy flags
  const isBvSuperAdmin = !!(userObj.isBvSuperAdmin || role === 'SUPER_ADMIN');
  const isBvAdmin = !!(userObj.isBvAdmin || isBvSuperAdmin || role === 'ADMIN');
  const isBvSupervisor = !!(userObj.isBvSupervisor || userObj.isBvMentor);
  const isBvFacilitator = !!(userObj.isBvFacilitator);
  const isBvSubFacilitator = !!(userObj.isBvSubFacilitator);

  // Determine segment ('PW' | 'FOLK')
  const segment = getUserDepartment(userObj);

  return {
    userId: userObj.userId ?? userObj.id ?? '',
    fullName: userObj.fullName ?? userObj.full_name ?? '',
    isPrabhupadaWorldUser: !!userObj.isPrabhupadaWorldUser,
    role: role as 'USER' | 'GUIDE' | 'SUPER_GUIDE' | 'SUPER_ADMIN' | 'BVSL' | 'SADHANA_MENTOR',
    status: (String(userObj.status || 'PENDING_APPROVAL').toUpperCase().replace(/[\s-]+/g, '_').trim()) as UserStatus,
    deletionRequestedAt: userObj.deletionRequestedAt ?? null,
    deletionPurgeAt: userObj.deletionPurgeAt ?? null,
    isBvsl,
    isSadhanaMentor,
    isServiceAllocator,
    isBvMentor,
    isCleanlinessManager,
    isBvSuperAdmin,
    isBvAdmin,
    isBvSupervisor,
    isBvFacilitator,
    isBvSubFacilitator,
    // This is set when a registration is approved and is what enables the
    // member-only Attendance tab in each user dashboard.
    isBvMember: !!userObj.isBvMember,
    isFolkLead: !!(userObj.isFolkLead),
    isTripCoordinator: !!(userObj.isTripCoordinator),
    folkResidencyCustomId,
    isResident,
    selectedGuideId: userObj.selectedGuideId ?? null,
    residencyUserClaim: !!(userObj.residencyUserClaim ?? userObj.residencyClaimed),
    residencyGuideVerified: userObj.residencyGuideVerified ?? userObj.residencyApproved ?? null,
    selectedFolkResidency,
    ashrayLevel: userObj.ashrayLevel ?? null,
    residencyName: userObj.residencyName ?? null,
    guideName: userObj.guideName ?? null,
    latestGuideTransferStatus: userObj.latestGuideTransferStatus ?? null,
    latestResidencyTransferStatus: userObj.latestResidencyTransferStatus ?? null,
    latestGuideTransferId: userObj.latestGuideTransferId ?? null,
    latestResidencyTransferId: userObj.latestResidencyTransferId ?? null,
    isPendingResidencyLeave: !!(userObj.isPendingResidencyLeave),
    latestAshrayStatus: userObj.latestAshrayStatus ?? null,
    latestAshrayId: userObj.latestAshrayId ?? null,
    latestAshrayRequestedLevel: userObj.latestAshrayRequestedLevel ?? null,
    acknowledgedFolkLead: !!(userObj.acknowledgedFolkLead),
    acknowledgedTripCoordinator: !!(userObj.acknowledgedTripCoordinator),
    acknowledgedSadhanaMentor: !!(userObj.acknowledgedSadhanaMentor),
    segment,
    pendingBvRejectionNotice: !!(userObj.pendingBvRejectionNotice),
    pendingBvApprovalNotice: !!(userObj.pendingBvApprovalNotice),
    pendingRoleNotice: userObj.pendingRoleNotice ?? null,
    pendingBvGroupAssignmentNotice: !!(userObj.pendingBvGroupAssignmentNotice),
    pendingBvGroupRemovalNotice: !!(userObj.pendingBvGroupRemovalNotice),
    roleNoticeAcknowledged: !!userObj.roleNoticeAcknowledged,
    bvRegistrationStatus: userObj.bvRegistrationStatus ?? null,
    bvGroupId: userObj.bvGroupId ?? null,
    bvGroupName: userObj.bvGroupName ?? null,
    bvReportingFacilitatorName: userObj.bvReportingFacilitatorName ?? null,
    pendingAshrayNoticeStatus: userObj.pendingAshrayNoticeStatus ?? null,
    pendingAshrayNoticeLevel: userObj.pendingAshrayNoticeLevel ?? null,
    ashrayNoticeAcknowledged: !!(userObj.ashrayNoticeAcknowledged),
    phone: userObj.phone ?? null,
  };
}

const MAX_RETRIES = 4;

export default function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading, logout } = useAuth();

  const [profile, setProfile] = useState<ProfileData>(null);
  const profileRef = useRef<ProfileData>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const loadedEmailRef = useRef<string | null>(null);
  const accountInvalidatedRef = useRef(false);

  const setAndCacheProfile = (p: ProfileData) => {
    profileRef.current = p;
    setProfile(p);
  };

  useEffect(() => {
    if (authLoading) return;

    if (user?.email) {
      load(user.email);
      // Debounce lastLogin writes — at most once per hour to avoid unnecessary DB writes
      const LAST_LOGIN_KEY = 'folk_login_ts';
      try {
        const lastTs = parseInt(localStorage.getItem(LAST_LOGIN_KEY) || '0', 10);
        if (Date.now() - lastTs > 60 * 60 * 1000) {
          updateLastLogin({}).then(() => {
            localStorage.setItem(LAST_LOGIN_KEY, String(Date.now()));
          }).catch(() => { });
        }
      } catch {
        updateLastLogin({}).catch(() => { });
      }
    } else {
      loadedEmailRef.current = null;
      setAndCacheProfile(null);
      setIsLoading(false);
    }
  }, [authLoading, user?.email]);

  // Real-time broadcast listener for immediate profile/role refreshes
  useEffect(() => {
    if (!user?.email) return;
    const handleRefreshEvent = () => {
      load(user.email!, 0, true);
    };
    window.addEventListener('pwa_profile_refresh_needed', handleRefreshEvent);
    return () => window.removeEventListener('pwa_profile_refresh_needed', handleRefreshEvent);
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roles, approvals, and account deletion now arrive through the scoped
  // Firestore invalidation stream; no focus/navigation/database polling.


  /**
   * @param email         - User email to load profile for
   * @param retryCount    - Retry attempt number (0 = first attempt)
   * @param background    - When true, skip setting isLoading/isError so existing
   *                        content stays visible (used on window focus refetch)
   */
  const load: (email: string, retryCount?: number, background?: boolean) => Promise<ProfileData> = useReactiveLoader<[email: string, retryCount?: number, background?: boolean], ProfileData>(async (read, email, retryCount = 0, background = false): Promise<ProfileData> => {
    background = background || read.background;
    // Only show the full-page loading spinner on the very first load
    if (!background && retryCount === 0 && !profileRef.current) {
      setIsLoading(true);
    }
    // Don't clear error in background mode — keep current UI state intact
    if (!background) {
      setProfileError(null);
    }

    let timedOut = false;
    // Timeout increases with each retry: 20s, 25s, 30s, 35s
    const timeoutMs = background ? 15_000 : 20_000 + retryCount * 5_000;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (background) return; // Silent failure for background refreshes
      if (retryCount < MAX_RETRIES) {
        const backoff = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s, 16s
        setTimeout(() => load(email, retryCount + 1), backoff);
        return;
      }
      setProfileError('Request timed out. Please tap Retry below.');
      setIsLoading(false);
    }, timeoutMs);

    try {
      // Profile state drives authorization and one-time notices. Always bypass
      // the short client cache so opening a page cannot reuse a stale role.
      const res = await read(() => getUserProfile({ email, _nocache: true }));
      if (timedOut) return null;
      clearTimeout(timeoutId);
      let built: ProfileData = null;
      if (res?.user) {
        built = buildProfile(res.user);
        setAndCacheProfile(built);
        rememberUserDepartment(built);
        loadedEmailRef.current = email;
        accountInvalidatedRef.current = false;
        try { localStorage.setItem('auth_profile_email', email.toLowerCase()); } catch { /* storage unavailable */ }
      } else {
        // An authenticated user whose previously loaded profile has vanished
        // was deleted or revoked. End the Firebase session and return to the
        // sign-in page; first-time users (without this marker) may still register.
        let hadConfirmedProfile = !!profileRef.current;
        try {
          hadConfirmedProfile = hadConfirmedProfile || localStorage.getItem('auth_profile_email') === email.toLowerCase();
        } catch { /* storage unavailable */ }
        setAndCacheProfile(null);
        loadedEmailRef.current = null;
        if (hadConfirmedProfile && !accountInvalidatedRef.current) {
          accountInvalidatedRef.current = true;
          await logout({ returnTo: getDepartmentLandingUrl(profileRef.current) });
          return null;
        }
      }
      if (!background) setIsLoading(false);
      else setIsLoading(false); // ensure loading clears even after initial
      return built;
    } catch (e) {
      clearTimeout(timeoutId);
      if (read.cancelled) return null;
      if (timedOut) return null;
      if (background) return null; // Silent failure — keep cached profile visible
      console.error('Profile load error:', e);
      if (retryCount < MAX_RETRIES) {
        const backoff = 2000 * Math.pow(2, retryCount); // exponential: 2s, 4s, 8s, 16s
        await new Promise(r => setTimeout(r, backoff));
        return load(email, retryCount + 1);
      }
      setProfileError('Could not load your profile. Please check your connection and tap Retry.');
      setIsLoading(false);
      return null;
    }
  }, [user?.email], Boolean(user?.email));

  const refreshProfile = async () => {
    if (!user?.email) return null;
    loadedEmailRef.current = null;
    // An explicit refresh must bypass the short client query cache so role and
    // BV membership changes are reflected immediately.
    return await load(user.email, 0, true);
  };

  const forceSetProfile = (userData: any) => {
    if (!userData || !user?.email) return;
    const built = buildProfile(userData);
    if (!built) return;
    loadedEmailRef.current = user.email;
    profileRef.current = built;
    setProfile(built);
    setIsLoading(false);
    setProfileError(null);
  };

  useEffect(() => {
    if (profile) {
      // Clear the post-registration safety flag only when the status is no longer pending.
      // This prevents a refresh or check status action from routing the user back to /register.
      if (profile.status === 'ACTIVE' || profile.status === 'REJECTED') {
        try { localStorage.removeItem('pwa_pending_registration'); } catch {}
      }
      localStorage.setItem('auth_role', profile.role || 'USER');
      localStorage.setItem('is_pw_admin', String(profile.isBvAdmin || profile.isBvSuperAdmin || profile.role === 'SUPER_ADMIN'));

      // ── 1. Registration Status Notice ──
      const lastSeenKey = `status_last_seen_${profile.userId}`;
      const lastSeen = localStorage.getItem(lastSeenKey);
      if (lastSeen) {
        if (lastSeen === 'PENDING_APPROVAL' && profile.status === 'ACTIVE') {
          toast.success('🎉 Your registration has been approved! Welcome to Prabhupada World Academy.', {
            duration: 10000,
          });
        } else if (lastSeen === 'PENDING_APPROVAL' && profile.status === 'REJECTED') {
          toast.error(`❌ Your registration request was rejected by ${profile.segment === 'PW' || profile.isPrabhupadaWorldUser ? 'the admin.' : 'your Guide.'}`, {
            duration: 10000,
          });
        }
      }
      localStorage.setItem(lastSeenKey, profile.status);

      // ── 2. Guide Transfer Status Notice ──
      if (profile.latestGuideTransferId && profile.latestGuideTransferStatus) {
        const guideKey = `seen_guide_transfer_${profile.latestGuideTransferId}`;
        const hasSeenGuide = localStorage.getItem(guideKey);
        if (!hasSeenGuide) {
          if (profile.latestGuideTransferStatus === 'Approved') {
            toast.success(`🎉 Your Guide Transfer request has been approved! Your new guide is ${profile.guideName || 'your selected guide'}.`, {
              duration: 10000,
            });
            localStorage.setItem(guideKey, 'true');
          } else if (profile.latestGuideTransferStatus === 'Rejected') {
            toast.error('❌ Your Guide Transfer request was rejected.', {
              duration: 10000,
            });
            localStorage.setItem(guideKey, 'true');
          }
        }
      }

      // ── 3. Residency Transfer Status Notice ──
      if (profile.latestResidencyTransferId && profile.latestResidencyTransferStatus) {
        const residencyKey = `seen_residency_transfer_${profile.latestResidencyTransferId}`;
        const hasSeenResidency = localStorage.getItem(residencyKey);
        if (!hasSeenResidency) {
          if (profile.latestResidencyTransferStatus === 'Approved') {
            if (profile.selectedFolkResidency) {
              toast.success(`🎉 Your request to join ${profile.residencyName || 'the residency'} has been approved!`, {
                duration: 10000,
              });
            } else {
              toast.success('🎉 Your request to leave the residency has been approved.', {
                duration: 10000,
              });
            }
            localStorage.setItem(residencyKey, 'true');
          } else if (profile.latestResidencyTransferStatus === 'Rejected') {
            toast.error('❌ Your Residency Transfer request was rejected.', {
              duration: 10000,
            });
            localStorage.setItem(residencyKey, 'true');
          }
        }
      }

      // ── 4. Ashray Upgrade Request Status Notice ──
      if (profile.latestAshrayId && profile.latestAshrayStatus) {
        const ashrayKey = `seen_ashray_upgrade_${profile.latestAshrayId}`;
        const hasSeenAshray = localStorage.getItem(ashrayKey);
        if (!hasSeenAshray) {
          if (profile.latestAshrayStatus === 'Passed') {
            toast.success(`🎉 Congratulations! Your request to upgrade to ${profile.latestAshrayRequestedLevel || 'the next level'} has been approved!`, {
              duration: 10000,
            });
            localStorage.setItem(ashrayKey, 'true');
          } else if (profile.latestAshrayStatus === 'Failed') {
            toast.error(`❌ Your request to upgrade to ${profile.latestAshrayRequestedLevel || 'the next level'} was not approved.`, {
              duration: 10000,
            });
            localStorage.setItem(ashrayKey, 'true');
          }
        }
      }
    } else {
      localStorage.removeItem('auth_role');
      localStorage.removeItem('is_pw_admin');
    }
  }, [profile]);

  return (
    <Ctx.Provider value={{ profile, isLoading, profileError, refreshProfile, forceSetProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export const useUserProfile = () => useContext(Ctx);
