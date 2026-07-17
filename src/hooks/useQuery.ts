import { useState, useEffect, useRef, useCallback } from 'react';
import { getCachedStale, setCached } from '@/utils/cache';

interface UseQueryOptions<T> {
  /** Unique cache key — falsy value disables fetching */
  key: string | null | undefined | false;
  /** The async fetcher function */
  fetcher: () => Promise<T>;
  /**
   * Cache TTL in milliseconds.
   * - 0 → no caching (always fetch fresh)
   * - Default 60 000ms (60s) — good for dashboard data
   */
  ttl?: number;
  /** Ignored — kept for API compat */
  refetchOnFocus?: boolean;
  /** Polling interval in ms (0 = off) */
  pollInterval?: number;
  /** Initial / placeholder data shown before first fetch */
  initialData?: T;
  /** Max retry attempts on failure (default 3) */
  maxRetries?: number;
}

interface UseQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  setData: (data: T) => void;
}

/**
 * Stale-while-revalidate data fetching hook with client-side caching.
 *
 * - If the cache has a fresh value for `key`: returns it immediately, no loading flash.
 * - If the cache has a stale value: shows it immediately, revalidates silently in background.
 * - If no cache: fetches with loading=true, caches the result.
 * - Retries up to maxRetries times on failure (exponential backoff).
 */
export function useQuery<T>({
  key,
  fetcher,
  ttl = 60_000,
  pollInterval = 0,
  initialData,
  maxRetries = 3,
}: UseQueryOptions<T>): UseQueryResult<T> {
  // Seed from cache so we can skip loading=true when stale data is available
  const getInitial = (): T | undefined => {
    if (!key || ttl === 0) return initialData;
    const cached = getCachedStale<T>(key);
    return cached ? cached.data : initialData;
  };

  const [data, setDataState] = useState<T | undefined>(getInitial);
  const [loading, setLoading] = useState(() => {
    if (!key) return false;
    if (ttl === 0) return true;
    const cached = getCachedStale<T>(key as string);
    return !cached; // Only show spinner if there's no cached data at all
  });
  const [error, setError] = useState<Error | null>(null);

  const mountedRef    = useRef(true);
  const fetcherRef    = useRef(fetcher);
  const isFetchingRef = useRef(false); // Prevent duplicate in-flight requests

  useEffect(() => { fetcherRef.current = fetcher; });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Full fetch with retry — shows loading only when there is no cached data. */
  const doFetch = useCallback(async (silent = false) => {
    if (!key) return;
    if (isFetchingRef.current) return; // Deduplicate concurrent calls
    isFetchingRef.current = true;

    if (!silent) {
      setError(null);
      // Only set loading if there is no data yet
      setLoading(prev => prev ? true : false);
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fetcherRef.current();
        if (!mountedRef.current) break;
        if (key && ttl > 0) setCached(key, result, ttl);
        setDataState(result);
        setLoading(false);
        isFetchingRef.current = false;
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1 && mountedRef.current) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    }
    if (mountedRef.current) {
      setError(lastErr);
      setLoading(false);
    }
    isFetchingRef.current = false;
  }, [key, ttl, maxRetries]);

  // Main effect: run on mount and key changes
  useEffect(() => {
    if (!key) { setLoading(false); return; }

    if (ttl > 0) {
      const cached = getCachedStale<T>(key);
      if (cached) {
        // Show stale data immediately, revalidate silently if expired
        setDataState(cached.data);
        setLoading(false);
        if (cached.isStale) doFetch(true); // Silent background revalidation
        return;
      }
    }

    // No cache — full fetch with loading state
    setLoading(true);
    doFetch(false);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling — silent background update (no loading flash)
  useEffect(() => {
    if (!pollInterval || !key) return;
    const id = setInterval(() => {
      if (!isFetchingRef.current) doFetch(true);
    }, pollInterval);
    return () => clearInterval(id);
  }, [pollInterval, key, doFetch]);

  const refetch = useCallback(() => {
    if (key) setCached(key, undefined as any, 0); // Bust cache
    return doFetch(false);
  }, [key, doFetch]);

  const setData = useCallback((newData: T) => setDataState(newData), []);

  return { data, loading, error, refetch, setData };
}
