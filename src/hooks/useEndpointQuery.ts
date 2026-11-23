import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getEndpointCacheSnapshot, getEndpointIdentityScope, getEndpointQueryRevision, isEndpointQueryFresh, queryCacheKey,
  queryEndpoint, subscribeEndpointCache, retainEndpointQuery,
} from '@/lib/app-endpoints-sdk';
import { useDashboardActivity } from '@/components/DashboardPanel';

/** Reactive SWR over the existing endpoint cache (no second copy of API data). */
export function useEndpointQuery<T>(name: string, input: Record<string, unknown>, enabled = true, { keepPreviousData = true } = {}) {
  const scope = useSyncExternalStore(subscribeEndpointCache, getEndpointIdentityScope, () => 'public');
  const key = queryCacheKey(name, input);
  const inputRef = useRef(input);
  inputRef.current = input;
  const active = useDashboardActivity();
  useEffect(() => enabled ? retainEndpointQuery(key) : undefined, [key, enabled]);
  const cache = useSyncExternalStore(subscribeEndpointCache,
    () => enabled ? getEndpointCacheSnapshot(name, inputRef.current) : undefined,
    () => undefined);
  // Invalidations must be observable even before an initial response has
  // populated the cache; an undefined cache snapshot alone cannot rerender.
  const revision = useSyncExternalStore(subscribeEndpointCache,
    () => getEndpointQueryRevision(name, inputRef.current), () => 0);
  const [state, setState] = useState<{ key: string; fetching: boolean; error: Error | null }>({ key, fetching: false, error: null });
  const latest = useRef(key);
  const retryAttempts = useRef(0);
  latest.current = key;
  const previous = useRef<{ name: string; scope: string; data: T } | null>(null);
  const denied = state.key === key && [401, 403].includes((state.error as any)?.status);
  const data = denied ? undefined : (cache?.data as T | undefined) ?? (keepPreviousData && previous.current?.name === name && previous.current.scope === scope ? previous.current.data : undefined);
  useEffect(() => {
    if (cache) previous.current = { name, scope, data: cache.data };
  }, [cache, name, scope]);

  const fetch = useCallback(async (force = false) => {
    if (!enabled) return;
    const requestKey = key;
    setState({ key: requestKey, fetching: true, error: null });
    try {
      await queryEndpoint<T>(name, { ...inputRef.current, ...(force ? { bypassCache: true } : {}) });
      retryAttempts.current = 0;
      if (latest.current === requestKey) setState({ key: requestKey, fetching: false, error: null });
    } catch (error) {
      if (latest.current === requestKey && [401, 403].includes((error as any)?.status)) previous.current = null;
      if (latest.current === requestKey) setState({ key: requestKey, fetching: false, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }, [key, name, enabled]);

  useEffect(() => { retryAttempts.current = 0; }, [key, revision]);
  useEffect(() => {
    if (!state.error || !enabled || !active || denied || !navigator.onLine || document.visibilityState === 'hidden' || retryAttempts.current >= 3) return;
    const retry = window.setTimeout(() => { void fetch(); }, 1000 * 2 ** retryAttempts.current++);
    return () => window.clearTimeout(retry);
  }, [state.error, enabled, active, denied, fetch]);

  useEffect(() => {
    if (!enabled || !active || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    if (isEndpointQueryFresh(name, inputRef.current)) return;
    // A short, event-triggered batch absorbs a burst of attendance writes.
    // This timer never repeats and does not check the server for changes.
    const batch = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') void fetch();
    }, cache ? 80 : 0);
    return () => window.clearTimeout(batch);
  }, [key, enabled, active, name, fetch, cache, revision]);
  useEffect(() => {
    if (!enabled || !active) return;
    const refreshStale = () => {
      if (document.visibilityState === 'visible' && !isEndpointQueryFresh(name, inputRef.current)) void fetch();
    };
    window.addEventListener('focus', refreshStale);
    window.addEventListener('online', refreshStale);
    document.addEventListener('visibilitychange', refreshStale);
    return () => {
      window.removeEventListener('focus', refreshStale);
      window.removeEventListener('online', refreshStale);
      document.removeEventListener('visibilitychange', refreshStale);
    };
  }, [enabled, active, fetch, name]);
  return {
    data: enabled ? data : undefined,
    loading: enabled && !data && (state.key !== key || state.fetching || !state.error),
    fetching: state.key === key && state.fetching,
    error: state.key === key ? state.error : null,
    refetch: useCallback(() => fetch(true), [fetch]),
  };
}
