// ══════════════════════════════════════════════════════════════════════════════
// useGuideData — Single source of truth for guide-related data fetching.
// Used by GuideDashboard tabs (UsersTab, ReportsTab, ApprovalsTab, etc.)
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { getGuideUsers, getPendingApprovals, getAllResidencies } from 'zite-endpoints-sdk';
import type {
  GetGuideUsersOutputType,
  GetPendingApprovalsOutputType,
  GetAllResidenciesOutputType,
} from 'zite-endpoints-sdk';

// getPendingApprovals returns an array directly
export type PendingApproval = GetPendingApprovalsOutputType[0];
// getAllResidencies returns an array directly
export type ResidencyItem = GetAllResidenciesOutputType[0];
// getGuideUsers returns { users: [...] }
export type GuideUser = GetGuideUsersOutputType['users'][0];

// ─── Guide Users ─────────────────────────────────────────────────────────────

interface UseGuideUsersResult {
  users: GuideUser[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useGuideUsers(guideId: string): UseGuideUsersResult {
  const [users, setUsers] = useState<GuideUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!guideId) return;
    let cancelled = false;
    setLoading(true);
    getGuideUsers({ guideId })
      .then(data => { if (!cancelled) setUsers(data.users); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load users'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guideId, tick]);

  return { users, loading, error, refetch };
}

// ─── Pending Approvals ───────────────────────────────────────────────────────

interface UsePendingApprovalsResult {
  requests: PendingApproval[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePendingApprovals(guideId: string): UsePendingApprovalsResult {
  const [requests, setRequests] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!guideId) return;
    let cancelled = false;
    setLoading(true);
    getPendingApprovals({ guideId })
      .then(data => { if (!cancelled) setRequests(data as PendingApproval[]); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load approvals'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [guideId, tick]);

  return { requests, loading, error, refetch };
}

// ─── All Residencies ─────────────────────────────────────────────────────────

interface UseResidenciesResult {
  residencies: ResidencyItem[];
  loading: boolean;
  error: string | null;
}

export function useResidencies(): UseResidenciesResult {
  const [residencies, setResidencies] = useState<ResidencyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllResidencies({})
      .then(data => { if (!cancelled) setResidencies(data as ResidencyItem[]); })
      .catch(e => { if (!cancelled) setError(e?.message ?? 'Failed to load residencies'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { residencies, loading, error };
}
