import { useCallback, useEffect, useLayoutEffect, useRef, type DependencyList } from 'react';
import { observeEndpointReads, retainEndpointQuery } from '@/lib/app-endpoints-sdk';
import { REALTIME_INVALIDATION_EVENT } from '@/lib/realtimeChannels';
import { useDashboardActivity } from '@/components/DashboardPanel';

export type ReactiveRead = {
  <T>(request: () => Promise<T>): Promise<T>;
  readonly background: boolean;
  readonly cancelled: boolean;
};

/** Bridge existing stateful loaders to exact endpoint-cache invalidations.
 * This preserves the component's data transformation, filters and local state.
 * Each SDK read is explicitly wrapped: read(() => getSomething(input)). */
export function useReactiveLoader<Args extends unknown[], Result>(
  loader: (read: ReactiveRead, ...args: Args) => Promise<Result>,
  dependencies: DependencyList,
  enabled = true,
  useCachedReads?: (...args: Args) => boolean,
) {
  const active = useDashboardActivity();
  const options = useRef({ loader, enabled, active, useCachedReads });
  options.current = { loader, enabled, active, useCachedReads };
  const state = useRef({ keys: new Set<string>(), args: undefined as Args | undefined,
    pins: new Map<string, () => void>(),
    generation: 0, mounted: true, running: false, dirty: false, retryAttempts: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const execute = useCallback(async (background: boolean, args: Args) => {
    const current = state.current;
    // First visits and new filter combinations may already have been prefetched.
    // Subsequent explicit reloads still force a read (including after mutations).
    const firstLoad = current.args === undefined;
    const generation = ++current.generation;
    current.running = true;
    current.dirty = false;
    current.args = args;
    if (!background) current.retryAttempts = 0;
    let failed = false;
    const keys = new Set<string>();
    const cancelled = () => {
      if (!current.mounted || generation !== current.generation) return true;
      if (background && !options.current.enabled) {
        // Editing may start after a background request was already sent.
        // Defer its UI application until the draft is saved or discarded.
        current.dirty = true;
        return true;
      }
      return false;
    };
    const read = Object.assign(async <T,>(request: () => Promise<T>): Promise<T> => {
      let result: T;
      try { result = await observeEndpointReads(request, key => {
        if (generation !== current.generation || !current.mounted) return;
        keys.add(key);
        current.keys.add(key);
        if (!current.pins.has(key)) current.pins.set(key, retainEndpointQuery(key));
      }, !background && !(options.current.useCachedReads?.(...args) ?? firstLoad)); }
      catch (error) {
        if (!cancelled() && ![401, 403].includes((error as { status?: number })?.status || 0)) {
          failed = true;
          current.dirty = true;
        }
        throw error;
      }
      if (cancelled()) throw Object.assign(new Error('Superseded query'), { name: 'AbortError' });
      return result;
    }, { background });
    Object.defineProperty(read, 'cancelled', { get: cancelled });
    try { return await options.current.loader(read as ReactiveRead, ...args); }
    finally {
      if (generation === current.generation) {
        for (const [key, release] of current.pins) if (!keys.has(key)) { release(); current.pins.delete(key); }
        current.keys = keys;
        current.running = false;
        if (failed) {
          // Retry a failed read at most three times, never a freshness loop.
          // If still unavailable, retain the dirty state for online/resume.
          if (current.retryAttempts++ < 3) schedule(1000 * 2 ** (current.retryAttempts - 1));
        } else {
          current.retryAttempts = 0;
          if (current.dirty) schedule();
        }
      }
    }
  // Call-site dependencies determine the loader's identity, just as useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  const executor = useRef(execute);
  executor.current = execute;
  function schedule(delay = 80) {
    const current = state.current;
    if (!current.mounted || !options.current.enabled || !options.current.active || navigator.onLine === false || document.visibilityState === 'hidden' || current.running || current.timer || !current.args) return;
    current.timer = setTimeout(() => {
      current.timer = undefined;
      // A panel or draft can become inactive during the batching window.
      if (!current.dirty || !current.mounted || !options.current.enabled || !options.current.active || document.visibilityState === 'hidden' || !current.args) return;
      void executor.current(true, current.args!).catch(error => {
        if (error?.name !== 'AbortError') console.warn('[Realtime] Background query failed', error);
      });
    }, delay);
  }
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    const invalidate = (event: Event) => {
      const detail = (event as CustomEvent<{ keys?: string[]; identityChanged?: boolean }>).detail;
      if (detail?.identityChanged) {
        current.generation++;
        current.running = false;
        current.dirty = true;
        schedule();
        return;
      }
      const keys = detail?.keys;
      if (!keys?.some(key => current.keys.has(key))) return;
      current.dirty = true;
      schedule();
    };
    const resume = () => { current.retryAttempts = 0; if (current.dirty) schedule(); };
    window.addEventListener(REALTIME_INVALIDATION_EVENT, invalidate);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      current.mounted = false;
      current.generation++;
      current.pins.forEach(release => release());
      current.pins.clear();
      clearTimeout(current.timer);
      current.timer = undefined;
      window.removeEventListener(REALTIME_INVALIDATION_EVENT, invalidate);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state.current.dirty) schedule(); }, [active, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    // A filter/identity change cancels results belonging to the old loader.
    // Layout timing matters when a caller's initial useEffect precedes us.
    state.current.generation++;
    state.current.mounted = true;
    state.current.pins.forEach(release => release());
    state.current.pins.clear();
    state.current.keys.clear();
    state.current.args = undefined;
    state.current.dirty = false;
    state.current.running = false;
    clearTimeout(state.current.timer);
    state.current.timer = undefined;
  }, [execute]);

  return useCallback((...args: Args) => execute(false, args), [execute]);
}
