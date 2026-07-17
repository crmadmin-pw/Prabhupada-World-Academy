/**
 * Client-side in-memory cache with TTL + stale-while-revalidate support.
 *
 * Uses a module-level Map — persists for the lifetime of the browser tab/session.
 * All cached values are served immediately (even if stale) while background
 * revalidation runs silently. This makes tab switching and page navigation feel
 * instant.
 *
 * Default TTLs (used by useQuery):
 *   - Dashboard / leaderboard data: 60s
 *   - Reference data (guides, residencies): 300s (5 min)
 *   - Anything else: 60s
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

// Purge any legacy pwac_* sessionStorage keys from previous versions
try {
  const toRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k?.startsWith('pwac_')) toRemove.push(k);
  }
  toRemove.forEach(k => sessionStorage.removeItem(k));
} catch {}

/** Get a cached value. Returns null if missing or expired. */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Get a cached value even if expired (stale).
 * Returns null only if the key has never been set.
 * Used for stale-while-revalidate pattern in useQuery.
 */
export function getCachedStale<T>(key: string): { data: T; isStale: boolean } | null {
  const entry = store.get(key);
  if (!entry) return null;
  return { data: entry.data as T, isStale: Date.now() > entry.expiresAt };
}

/** Write a value to the cache. Default TTL = 60 seconds. */
export function setCached<T>(key: string, data: T, ttlMs = 60_000): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Delete a specific key. Omit key to clear everything. */
export function invalidateCache(key?: string): void {
  if (!key) { store.clear(); return; }
  store.delete(key);
}

/** Delete all keys containing the given userId string. */
export function invalidateUserDashboardCache(userId: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.includes(userId)) store.delete(key);
  }
}

/** Delete all keys starting with the given prefix. */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Read-through: returns cached value (if not expired), otherwise fetches,
 * caches, and returns the new value.
 */
export async function getOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 60_000,
): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;
  const data = await fetcher();
  setCached(key, data, ttlMs);
  return data;
}
