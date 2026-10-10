export const OFFLINE_QUEUE_STORAGE_KEY = 'pwa_offline_pending_queue';

const MAX_QUEUE_ITEMS = 30;
const MAX_ATTEMPTS = 8;

export interface PendingQueueItem {
  id: string;
  type: 'sadhana_entry' | 'bv_registration' | 'role_update';
  payload: any;
  timestamp: number;
  dedupeKey?: string;
  attempts?: number;
  retryAfter?: number;
}

export interface OfflineFlushResult {
  synced: number;
  pending: number;
  dropped: number;
}

type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SyncHandler = (item: PendingQueueItem) => Promise<void>;

const SAVED_LOCALLY_MESSAGE = 'Saved locally. Will auto-sync when network connection is restored.';

let storageOverride: QueueStorage | null = null;
let installedHandler: SyncHandler | null = null;
let activeFlush: Promise<OfflineFlushResult> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const dedupeLocks = new Map<string, Promise<void>>();

export function setOfflineQueueStorageForTests(storage: QueueStorage | null) {
  storageOverride = storage;
}

function queueStorage(): QueueStorage | null {
  if (storageOverride) return storageOverride;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function browserIsOffline(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false;
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isPermanentSyncError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === undefined) return false;
  if (status === 401 || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

export function isRetryableSyncError(error: unknown): boolean {
  if (browserIsOffline()) return true;
  if (isPermanentSyncError(error)) return false;
  const status = errorStatus(error);
  if (status === 401 || status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  const name = (error as { name?: string } | null)?.name || '';
  const message = String((error as { message?: string } | null)?.message || error || '');
  if (name === 'TypeError') return true;
  if (/failed to fetch|networkerror|network request failed|load failed|offline|not authenticated|unavailable/i.test(message)) return true;
  return status === undefined;
}

function notify(level: 'info' | 'success' | 'error', message: string, id?: string) {
  if (typeof document === 'undefined' || !document.body) return;
  void import('sonner').then(({ toast }) => {
    toast[level](message, id ? { id, duration: 4000 } : undefined);
  }).catch(() => {});
}

function scheduleRetry(retryAfter: number) {
  const delay = Math.max(0, retryAfter - Date.now()) + 25;
  if (retryTimer) clearTimeout(retryTimer);
  const timer = setTimeout(() => {
    retryTimer = null;
    void flushOfflineQueue();
  }, delay);
  retryTimer = timer;
  (timer as { unref?: () => void }).unref?.();
}

function readQueue(): PendingQueueItem[] {
  const storage = queueStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PendingQueueItem =>
      !!item && typeof item.id === 'string' && typeof item.type === 'string' && item.payload != null
    );
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingQueueItem[]) {
  const storage = queueStorage();
  if (!storage) throw new Error('Offline storage is unavailable on this device.');
  storage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export function getOfflineQueue(): PendingQueueItem[] {
  return readQueue();
}

export function enqueueOfflinePayload(
  type: PendingQueueItem['type'],
  payload: any,
  options?: { dedupeKey?: string; silent?: boolean },
): string {
  const item: PendingQueueItem = {
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    timestamp: Date.now(),
    dedupeKey: options?.dedupeKey,
    attempts: 0,
  };
  const dedupeKey = options?.dedupeKey;
  const queue = readQueue().filter(existing => !dedupeKey || existing.dedupeKey !== dedupeKey);
  queue.push(item);
  const bounded = queue.length > MAX_QUEUE_ITEMS ? queue.slice(queue.length - MAX_QUEUE_ITEMS) : queue;
  writeQueue(bounded);
  if (!options?.silent) notify('info', SAVED_LOCALLY_MESSAGE);
  return item.id;
}

export function clearOfflineQueue() {
  queueStorage()?.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
}

function removeWhere(match: (item: PendingQueueItem) => boolean) {
  writeQueue(readQueue().filter(item => !match(item)));
}

function replaceItem(id: string, timestamp: number, next: PendingQueueItem) {
  writeQueue(readQueue().map(item => item.id === id && item.timestamp === timestamp ? next : item));
}

export function withOfflineDedupeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = dedupeLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  dedupeLocks.set(key, tail);
  return previous.then(fn).finally(() => {
    release();
    if (dedupeLocks.get(key) === tail) dedupeLocks.delete(key);
  });
}

function recordLabel(item: PendingQueueItem): string {
  if (item.type === 'sadhana_entry') return 'sadhana entry';
  if (item.type === 'bv_registration') return 'Bhakti Vriksha registration';
  return 'role change';
}

async function runFlush(handler: SyncHandler): Promise<OfflineFlushResult> {
  let synced = 0;
  let dropped = 0;
  const deferred = new Set<string>();

  for (let steps = 0; steps < 50; steps++) {
    const snapshot = readQueue().find(item =>
      (!item.retryAfter || item.retryAfter <= Date.now()) && !deferred.has(item.id)
    );
    if (!snapshot) break;

    const key = snapshot.dedupeKey || snapshot.id;
    await withOfflineDedupeLock(key, async () => {
      const current = readQueue().find(item => item.id === snapshot.id && item.timestamp === snapshot.timestamp);
      if (!current) return;
      try {
        await handler(current);
        removeWhere(item => item.id === current.id && item.timestamp === current.timestamp);
        synced++;
      } catch (error) {
        const attempts = (current.attempts ?? 0) + 1;
        const giveUp = isPermanentSyncError(error) || attempts >= MAX_ATTEMPTS;
        if (giveUp) {
          removeWhere(item => item.id === current.id && item.timestamp === current.timestamp);
          dropped++;
          const message = error instanceof Error ? error.message : 'The server rejected the saved record.';
          notify('error', `A saved ${recordLabel(current)} was not synced (${message}). Please submit it again.`);
          return;
        }
        const retryAfter = Date.now() + Math.min(60_000, 1000 * 2 ** attempts);
        replaceItem(current.id, current.timestamp, { ...current, attempts, retryAfter });
        deferred.add(current.id);
        scheduleRetry(retryAfter);
      }
    });
  }

  if (synced > 0) notify('success', `Successfully synced ${synced} offline record(s)!`);
  return { synced, pending: readQueue().length, dropped };
}

export function flushOfflineQueue(handler?: SyncHandler): Promise<OfflineFlushResult> {
  const resolved = handler || installedHandler;
  if (!resolved) return Promise.resolve({ synced: 0, pending: readQueue().length, dropped: 0 });
  if (browserIsOffline()) return Promise.resolve({ synced: 0, pending: readQueue().length, dropped: 0 });
  if (activeFlush) {
    return activeFlush.then(result => {
      const ready = readQueue().some(item => !item.retryAfter || item.retryAfter <= Date.now());
      return ready ? flushOfflineQueue(handler) : result;
    });
  }
  const run = runFlush(resolved).finally(() => { activeFlush = null; });
  activeFlush = run;
  return run;
}

export async function processOfflineQueue(syncCallback: (item: PendingQueueItem) => Promise<boolean>) {
  await flushOfflineQueue(async item => {
    const success = await syncCallback(item);
    if (!success) throw new Error('Sync deferred until the network is available.');
  });
}

export async function sendOrQueue<T>(options: {
  type: PendingQueueItem['type'];
  payload: any;
  dedupeKey: string;
  send: () => Promise<T>;
  toastId?: string;
}): Promise<{ status: 'sent'; result: T } | { status: 'queued'; id: string }> {
  const outcome = await withOfflineDedupeLock(options.dedupeKey, async () => {
    if (!browserIsOffline()) {
      try {
        const result = await options.send();
        removeWhere(item => item.dedupeKey === options.dedupeKey);
        return { status: 'sent' as const, result };
      } catch (error) {
        if (!isRetryableSyncError(error)) throw error;
      }
    }
    const id = enqueueOfflinePayload(options.type, options.payload, {
      dedupeKey: options.dedupeKey,
      silent: true,
    });
    notify('info', SAVED_LOCALLY_MESSAGE, options.toastId);
    return { status: 'queued' as const, id };
  });

  if (outcome.status === 'queued' && !browserIsOffline()) void flushOfflineQueue();
  return outcome;
}

export function installOfflineSync(handler: SyncHandler): () => void {
  installedHandler = handler;
  if (typeof window === 'undefined') return () => { if (installedHandler === handler) installedHandler = null; };

  const onOnline = () => {
    const queue = readQueue();
    if (queue.length === 0) return;
    writeQueue(queue.map(item => ({ ...item, retryAfter: 0 })));
    notify('info', `Back online! Syncing ${queue.length} pending record(s)...`);
    void flushOfflineQueue();
  };
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (browserIsOffline() || readQueue().length === 0) return;
    void flushOfflineQueue();
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  if (!browserIsOffline() && readQueue().length > 0) void flushOfflineQueue();

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    if (installedHandler === handler) installedHandler = null;
  };
}
