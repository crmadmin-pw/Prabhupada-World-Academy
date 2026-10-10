import { useState, useEffect, useRef, useCallback } from 'react';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { getEndpointCacheEntry, observeEndpointReads, writeEndpointCacheEntry } from '@/lib/app-endpoints-sdk';
import type { RealtimeChannel } from '@/lib/realtimeChannels';

interface UseQueryOptions<T> {
  /** Unique cache key — falsy value disables fetching */
  key: string | null | undefined | false;
  /** The async fetcher function */
  fetcher: () => Promise<T>;
  /**
   * Pass 0 to bypass the shared endpoint cache.
   * Any other value reads and updates that cache. It does not start a second timer.
   */
  ttl?: number;
  /** Ignored — kept for API compat */
  refetchOnFocus?: boolean;
  /** Ignored — exact endpoint keys already follow the realtime stream. */
  realtimeChannels?: RealtimeChannel[];
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

/** Points a useQuery key at the endpoint-cache entry observed for that read.
 * The map stores no response body. The endpoint cache is the only copy.
 */
const endpointKeyByQueryKey = new Map<string, string>();

function cachedEndpointEntry(key: string | null | undefined | false, ttl: number) {
  if (!key || ttl <= 0) return undefined;
  const endpointKey = endpointKeyByQueryKey.get(key);
  if (!endpointKey) return undefined;
  return getEndpointCacheEntry(endpointKey);
}

/**
 * Stale-while-revalidate reads over the shared endpoint cache.
 *
 * - A cached response is shown immediately, including while it is being refreshed.
 * - Realtime invalidation marks that same entry stale, so the next read cannot
 *   keep the pre-change response until a separate timer expires.
 * - Retries up to maxRetries times on failure (exponential backoff).
 */
export function useQuery<T>({
  key,
  fetcher,
  ttl = 60_000,
  initialData,
  maxRetries = 3,
}: UseQueryOptions<T>): UseQueryResult<T> {
  const initialEntry = cachedEndpointEntry(key, ttl);
  const [data, setDataState] = useState<T | undefined>(initialEntry ? initialEntry.data as T : initialData);
  const [loading, setLoading] = useState(() => {
    if (!key) return false;
    if (ttl <= 0) return true;
    return !cachedEndpointEntry(key, ttl);
  });
  const [error, setError] = useState<Error | null>(null);

  const mountedRef    = useRef(true);
  const fetcherRef    = useRef(fetcher);

  useEffect(() => { fetcherRef.current = fetcher; });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Full fetch with retry — shows loading only when there is no cached data. */
  const doFetch = useReactiveLoader(async (read, silent = false) => {
    if (!key) return;
    const queryKey = key;

    if (!silent) {
      setError(null);
      // Only set loading if there is no data yet
      setLoading(prev => prev ? true : false);
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await read(() => observeEndpointReads(() => fetcherRef.current(), endpointKey => {
          endpointKeyByQueryKey.set(queryKey, endpointKey);
        }));
        if (!mountedRef.current || read.cancelled) break;
        setDataState(result);
        setLoading(false);
        return;
      } catch (err) {
        if (read.cancelled) return;
        lastErr = err instanceof Error ? err : new Error(String(err));
        if ([401, 403].includes((err as { status?: number })?.status || 0)) {
          endpointKeyByQueryKey.delete(queryKey);
          setDataState(undefined);
          break;
        }
        if (attempt < maxRetries - 1 && mountedRef.current) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    }
    if (mountedRef.current && !read.cancelled) {
      setError(lastErr);
      setLoading(false);
    }
  }, [key, ttl, maxRetries], true, silent => ttl > 0 && !!silent);

  // Main effect: run on mount and key changes
  useEffect(() => {
    let cancelled = false;
    // Defer state synchronization to a microtask. This avoids an extra
    // synchronous render while React is committing the key-change effect.
    queueMicrotask(() => {
      if (cancelled || !mountedRef.current) return;
      if (!key) {
        setDataState(initialData);
        setLoading(false);
        return;
      }

      const cached = cachedEndpointEntry(key, ttl);
      if (cached) {
        // Show the shared entry immediately. A fresh entry is served from
        // that cache; a realtime invalidation makes the same entry refetch.
        setDataState(cached.data as T);
        setLoading(false);
        void doFetch(true);
        return;
      }

      setLoading(true);
      void doFetch(ttl > 0);
    });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => doFetch(false), [doFetch]);

  const setData = useCallback((newData: T) => {
    setDataState(newData);
    if (!key || ttl <= 0) return;
    const endpointKey = endpointKeyByQueryKey.get(key);
    if (endpointKey) writeEndpointCacheEntry(endpointKey, newData);
  }, [key, ttl]);

  return { data, loading, error, refetch, setData };
}
