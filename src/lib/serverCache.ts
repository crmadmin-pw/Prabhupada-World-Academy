/**
 * Server-side cache for expensive lookups.
 *
 * Each process keeps a memory copy. Guide, residency, and other reference lists
 * are also stored in Firestore under one shared epoch. A change advances that
 * epoch, so every server drops its copy and reads the updated list.
 */

import { isReactiveRequest } from './requestQueries';

const SHARED_KEY_PREFIXES = ['ref:', 'reportReference:', 'service_reference:', 'sadhana_fields:'];
const SHARED_COLLECTION = 'ServerCache';
const EPOCH_ID = '__epoch';
const MAX_SHARED_PAYLOAD = 800_000;

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  epoch: number | null;
}

export interface SharedCacheRecord {
  data: unknown;
  expiresAt: number;
  epoch: number;
}

export interface SharedServerCache {
  currentEpoch(): Promise<number | null>;
  bumpEpoch(): Promise<void>;
  read(key: string): Promise<SharedCacheRecord | null>;
  write(key: string, entry: SharedCacheRecord): Promise<void>;
  subscribe(listener: (epoch: number) => void): () => void;
}

export function isSharedReferenceCacheKey(key: string): boolean {
  return SHARED_KEY_PREFIXES.some(prefix => key.startsWith(prefix));
}

function invalidationTouchesSharedCache(prefix?: string): boolean {
  if (!prefix) return true;
  return SHARED_KEY_PREFIXES.some(sharedPrefix => sharedPrefix.startsWith(prefix) || prefix.startsWith(sharedPrefix));
}

function snapshotExists(snap: any): boolean {
  return typeof snap?.exists === 'function' ? snap.exists() : !!snap?.exists;
}

function snapshotData(snap: any): any {
  return typeof snap?.data === 'function' ? snap.data() : snap?.data;
}

export function createMemorySharedServerCache(): SharedServerCache {
  let epoch = 0;
  const entries = new Map<string, SharedCacheRecord>();
  const listeners = new Set<(epoch: number) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async currentEpoch() {
      return epoch;
    },
    async bumpEpoch() {
      epoch += 1;
      listeners.forEach(listener => listener(epoch));
    },
    async read(key) {
      const entry = entries.get(key);
      return entry ? { ...entry, data: structuredClone(entry.data) } : null;
    },
    async write(key, entry) {
      entries.set(key, { ...entry, data: structuredClone(entry.data) });
    },
  };
}

type DatabaseProvider = () => any;
let databaseProvider: DatabaseProvider = () => null;

export function attachSharedCacheDatabase(provider: DatabaseProvider) {
  databaseProvider = provider;
}

export function createFirestoreSharedServerCache(getDatabase: DatabaseProvider = () => databaseProvider()): SharedServerCache {
  let epoch: number | null = null;
  let listening = false;
  const listeners = new Set<(next: number) => void>();

  const publish = (next: number) => {
    if (epoch === next || (epoch !== null && next < epoch)) return;
    epoch = next;
    listeners.forEach(listener => listener(next));
  };

  const watch = (db: any) => {
    if (listening || typeof db?.collection !== 'function') return;
    listening = true;
    try {
      db.collection(SHARED_COLLECTION).doc(EPOCH_ID).onSnapshot((snap: any) => {
        publish(snapshotExists(snap) ? Number(snapshotData(snap)?.epoch || 0) : 0);
      }, () => {
        epoch = null;
      });
    } catch {
      listening = false;
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async currentEpoch() {
      const db = getDatabase();
      if (!db) return null;
      watch(db);
      if (epoch !== null) return epoch;
      const snap = await db.collection(SHARED_COLLECTION).doc(EPOCH_ID).get();
      const next = snapshotExists(snap) ? Number(snapshotData(snap)?.epoch || 0) : 0;
      publish(next);
      return next;
    },
    async bumpEpoch() {
      const db = getDatabase();
      if (!db) return;
      const ref = db.collection(SHARED_COLLECTION).doc(EPOCH_ID);
      let next = 0;
      await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const current = snapshotExists(snap) ? Number(snapshotData(snap)?.epoch || 0) : 0;
        next = current + 1;
        tx.set(ref, { epoch: next, updatedAt: new Date().toISOString() }, { merge: true });
      });
      publish(next);
    },
    async read(key) {
      const db = getDatabase();
      if (!db) return null;
      const snap = await db.collection(SHARED_COLLECTION).doc(sharedDocumentId(key)).get();
      if (!snapshotExists(snap)) return null;
      const stored = snapshotData(snap);
      return {
        data: JSON.parse(String(stored?.payload || 'null')),
        expiresAt: Number(stored?.expiresAt || 0),
        epoch: Number(stored?.epoch || 0),
      };
    },
    async write(key, entry) {
      const db = getDatabase();
      if (!db) return;
      const payload = JSON.stringify(entry.data);
      if (payload.length > MAX_SHARED_PAYLOAD) return;
      await db.collection(SHARED_COLLECTION).doc(sharedDocumentId(key)).set({
        key,
        payload,
        expiresAt: entry.expiresAt,
        epoch: entry.epoch,
      });
    },
  };
}

function sharedDocumentId(key: string): string {
  return `entry_${Buffer.from(key).toString('base64url')}`;
}

export interface ServerCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttlMs?: number): void;
  invalidate(prefix?: string, options?: { publish?: boolean }): Promise<void>;
  getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T>;
  keys(): string[];
}

export function createServerCache(shared: SharedServerCache): ServerCache {
  const store = new Map<string, CacheEntry<unknown>>();
  const inFlight = new Map<string, Promise<unknown>>();
  let cacheGeneration = 0;
  shared.subscribe(() => {
    for (const key of Array.from(store.keys())) if (isSharedReferenceCacheKey(key)) store.delete(key);
    for (const key of Array.from(inFlight.keys())) if (isSharedReferenceCacheKey(key)) inFlight.delete(key);
  });

  function get<T>(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  function set<T>(key: string, data: T, ttlMs = 60 * 60 * 1000, epoch: number | null = null): void {
    store.delete(key);
    store.set(key, { data, expiresAt: Date.now() + ttlMs, epoch });
    while (store.size > 250) store.delete(store.keys().next().value!);
  }

  function invalidate(prefix?: string, options?: { publish?: boolean }): Promise<void> {
    cacheGeneration++;
    if (!prefix) {
      store.clear();
      inFlight.clear();
    } else {
      for (const key of Array.from(store.keys())) if (key.startsWith(prefix)) store.delete(key);
      for (const key of Array.from(inFlight.keys())) if (key.startsWith(prefix)) inFlight.delete(key);
    }
    if (options?.publish === false || !invalidationTouchesSharedCache(prefix)) return Promise.resolve();
    const publishing = shared.bumpEpoch().then(() => undefined, () => undefined);
    trackSharedWrite(publishing);
    return publishing;
  }

  async function getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs = 60 * 60 * 1000): Promise<T> {
    if (isReactiveRequest()) return fetcher();
    if (!isSharedReferenceCacheKey(key)) {
      const cached = get<T>(key);
      if (cached !== null) return cached;
    }
    const pending = inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const generation = cacheGeneration;
    const request = (async () => {
      const epoch = isSharedReferenceCacheKey(key) ? await shared.currentEpoch().catch(() => null) : null;
      if (epoch === null) {
        const cached = get<T>(key);
        if (cached !== null) return cached;
      } else {
        const local = store.get(key);
        if (local && local.epoch === epoch && Date.now() <= local.expiresAt) return local.data as T;
        const remote = await shared.read(key).catch(() => null);
        if (remote && remote.epoch === epoch && Date.now() <= remote.expiresAt && generation === cacheGeneration) {
          set(key, remote.data, Math.max(1, remote.expiresAt - Date.now()), epoch);
          return remote.data as T;
        }
      }
      const data = await fetcher();
      const latestEpoch = epoch === null ? null : await shared.currentEpoch().catch(() => null);
      if (generation === cacheGeneration && latestEpoch === epoch) {
        set(key, data, ttlMs, epoch);
        if (epoch !== null) {
          trackSharedWrite(shared.write(key, {
            data,
            expiresAt: Date.now() + ttlMs,
            epoch,
          }).then(() => undefined, () => undefined));
        }
      }
      return data;
    })();
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (inFlight.get(key) === request) inFlight.delete(key);
    }
  }

  function keys(): string[] {
    const now = Date.now();
    return Array.from(store.entries())
      .filter(([, entry]) => entry.expiresAt > now)
      .map(([key]) => key);
  }

  return { get, set, invalidate, getOrFetch, keys };
}

let sharedWrites = Promise.resolve();

function trackSharedWrite(work: Promise<void>) {
  sharedWrites = sharedWrites.then(() => work, () => work);
}

/** Resolves after this process has stored its shared reference-cache updates. */
export function whenServerCacheShared(): Promise<void> {
  return sharedWrites;
}

const serverCache = createServerCache(createFirestoreSharedServerCache());

export function serverCacheGet<T>(key: string): T | null {
  return serverCache.get<T>(key);
}

export function serverCacheSet<T>(key: string, data: T, ttlMs = 60 * 60 * 1000): void {
  serverCache.set(key, data, ttlMs);
}

export function serverCacheInvalidate(prefix?: string, options?: { publish?: boolean }): Promise<void> {
  return serverCache.invalidate(prefix, options);
}

export function serverCacheGetOrFetch<T>(key: string, fetcher: () => Promise<T>, ttlMs = 60 * 60 * 1000): Promise<T> {
  return serverCache.getOrFetch(key, fetcher, ttlMs);
}

export function serverCacheKeys(): string[] {
  return serverCache.keys();
}
