// ══════════════════════════════════════════════════════════════════════════════
// useBvData — Single source of truth for BV group data fetching.
// Used by BhaktiVrikshaPage, BvGroupDetailPage, BvslDashboard, etc.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { getAllBvGroups, getUserBvStatus } from 'zite-endpoints-sdk';
import type {
  GetAllBvGroupsOutputType,
  GetUserBvStatusOutputType,
} from 'zite-endpoints-sdk';

export type BvGroupItem = GetAllBvGroupsOutputType['groups'][0];
export type UserBvStatus = GetUserBvStatusOutputType;

// ─── All BV Groups (for a user) ──────────────────────────────────────────────

interface UseAllBvGroupsResult {
  groups: BvGroupItem[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAllBvGroups(userId?: string): UseAllBvGroupsResult {
  const [groups, setGroups] = useState<BvGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAllBvGroups({ userId: userId ?? '' })
      .then(data => { if (!cancelled) setGroups(data.groups); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load BV groups'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, tick]);

  return { groups, loading, error, refetch };
}

// ─── User's BV Status ────────────────────────────────────────────────────────

interface UseUserBvStatusResult {
  status: UserBvStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserBvStatus(userId: string, localDate?: string): UseUserBvStatusResult {
  const [status, setStatus] = useState<UserBvStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    getUserBvStatus({ userId, localDate })
      .then(data => { if (!cancelled) setStatus(data); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load BV status'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, localDate, tick]);

  return { status, loading, error, refetch };
}
