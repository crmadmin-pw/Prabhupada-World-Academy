import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getUserProfile, updateLastLogin } from 'zite-endpoints-sdk';
import type { ProfileSummary } from '@/types/models';
import { toast } from 'sonner';

// Re-export for backward compatibility — NEW CODE should import from '@/types/models'
export type ProfileData = ProfileSummary | null;

type ProfileCtx = {
  profile: ProfileData;
  isLoading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  /** Directly set profile from known user data (used by login resolution pages) */
  forceSetProfile: (userData: any) => void;
};

const Ctx = createContext<ProfileCtx>({
  profile: null,
  isLoading: true,
  profileError: null,
  refreshProfile: async () => {},
  forceSetProfile: () => {},
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

  const rawRole = ((userObj.role as string) || 'USER').toUpperCase().replace(/\s+/g, '_').trim();
  const validRoles = ['USER', 'GUIDE', 'SUPER_GUIDE', 'BVSL', 'SADHANA_MENTOR'];
  const role = validRoles.includes(rawRole) ? rawRole : 'USER';

  const isBvsl = !!(userObj.isBvsl || role === 'BVSL');
  const isSadhanaMentor = !!(userObj.isSadhanaMentor || role === 'SADHANA_MENTOR');
  const isServiceAllocator = !!(userObj.isServiceAllocator);
  const isBvMentor = !!(userObj.isBvMentor);
  const isCleanlinessManager = !!(userObj.isCleanlinessManager);
  const folkResidencyCustomId = userObj.folkResidencyCustomId ?? null;

  return {
    userId: userObj.userId ?? userObj.id ?? '',
    fullName: userObj.fullName ?? userObj.full_name ?? '',
    role: role as 'USER' | 'GUIDE' | 'SUPER_GUIDE' | 'BVSL' | 'SADHANA_MENTOR',
    status: (((userObj.status as string) || 'PENDING_APPROVAL').toUpperCase().replace(' ', '_').trim()) as
      'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED',
    isBvsl,
    isSadhanaMentor,
    isServiceAllocator,
    isBvMentor,
    isCleanlinessManager,
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
  };
}

const MAX_RETRIES = 4;

export default function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();

  const [profile, setProfile] = useState<ProfileData>(null);
  const profileRef = useRef<ProfileData>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const loadedEmailRef   = useRef<string | null>(null);
  const lastFetchedAtRef = useRef<number>(0); // Timestamp of last successful profile fetch

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
          }).catch(() => {});
        }
      } catch {
        updateLastLogin({}).catch(() => {});
      }
    } else {
      loadedEmailRef.current = null;
      setAndCacheProfile(null);
      setIsLoading(false);
    }
  }, [authLoading, user?.email]);

  // Refresh profile when tab becomes visible — but only if > 5 min since last fetch
  // Prevents a flood of DB calls when the user rapidly switches tabs
  const FOCUS_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  useEffect(() => {
    if (!user?.email) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetchedAtRef.current < FOCUS_COOLDOWN_MS) return;
        load(user.email!, 0, true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * @param email         - User email to load profile for
   * @param retryCount    - Retry attempt number (0 = first attempt)
   * @param background    - When true, skip setting isLoading/isError so existing
   *                        content stays visible (used on window focus refetch)
   */
  const load = async (email: string, retryCount = 0, background = false) => {
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
      const res = await getUserProfile({ email });
      if (timedOut) return;
      clearTimeout(timeoutId);
      if (res?.user) {
        setAndCacheProfile(buildProfile(res.user));
        loadedEmailRef.current = email;
        lastFetchedAtRef.current = Date.now();
      } else {
        setAndCacheProfile(null);
        loadedEmailRef.current = null;
      }
      if (!background) setIsLoading(false);
      else setIsLoading(false); // ensure loading clears even after initial
    } catch (e) {
      clearTimeout(timeoutId);
      if (timedOut) return;
      if (background) return; // Silent failure — keep cached profile visible
      console.error('Profile load error:', e);
      if (retryCount < MAX_RETRIES) {
        const backoff = 2000 * Math.pow(2, retryCount); // exponential: 2s, 4s, 8s, 16s
        await new Promise(r => setTimeout(r, backoff));
        return load(email, retryCount + 1);
      }
      setProfileError('Could not load your profile. Please check your connection and tap Retry.');
      setIsLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (!user?.email) return;
    loadedEmailRef.current = null;
    await load(user.email);
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
      // ── 1. Registration Status Notice ──
      const lastSeenKey = `status_last_seen_${profile.userId}`;
      const lastSeen = localStorage.getItem(lastSeenKey);
      if (lastSeen) {
        if (lastSeen === 'PENDING_APPROVAL' && profile.status === 'ACTIVE') {
          toast.success('🎉 Your registration has been approved! Welcome to Prabhupada World Academy.', {
            duration: 10000,
            position: 'top-center',
          });
        } else if (lastSeen === 'PENDING_APPROVAL' && profile.status === 'REJECTED') {
          toast.error('❌ Your registration request was rejected by your Guide.', {
            duration: 10000,
            position: 'top-center',
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
              position: 'top-center',
            });
            localStorage.setItem(guideKey, 'true');
          } else if (profile.latestGuideTransferStatus === 'Rejected') {
            toast.error('❌ Your Guide Transfer request was rejected.', {
              duration: 10000,
              position: 'top-center',
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
                position: 'top-center',
              });
            } else {
              toast.success('🎉 Your request to leave the residency has been approved.', {
                duration: 10000,
                position: 'top-center',
              });
            }
            localStorage.setItem(residencyKey, 'true');
          } else if (profile.latestResidencyTransferStatus === 'Rejected') {
            toast.error('❌ Your Residency Transfer request was rejected.', {
              duration: 10000,
              position: 'top-center',
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
              position: 'top-center',
            });
            localStorage.setItem(ashrayKey, 'true');
          } else if (profile.latestAshrayStatus === 'Failed') {
            toast.error(`❌ Your request to upgrade to ${profile.latestAshrayRequestedLevel || 'the next level'} was not approved.`, {
              duration: 10000,
              position: 'top-center',
            });
            localStorage.setItem(ashrayKey, 'true');
          }
        }
      }
    }
  }, [profile]);

  return (
    <Ctx.Provider value={{ profile, isLoading, profileError, refreshProfile, forceSetProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export const useUserProfile = () => useContext(Ctx);
