// ══════════════════════════════════════════════════════════════════════════════
// useUserProfile — Single source of truth for user profile data fetching.
// Used by UserDashboard, ProfilePage, and any component that needs the profile.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getUserProfile } from 'zite-endpoints-sdk';
import type { GetUserProfileOutputType } from 'zite-endpoints-sdk';

export type UserProfileData = NonNullable<GetUserProfileOutputType['user']>;

interface UseUserProfileResult {
  profile: UserProfileData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserProfile(): UseUserProfileResult {
  const { user: authUser, isLoading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (authLoading || !authUser?.email) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserProfile({ email: authUser.email })
      .then(data => { if (!cancelled) setProfile(data.user); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load profile'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authUser?.email, authLoading, tick]);

  return { profile, loading, error, refetch };
}
