// Shared abuse-prevention counters.
// Every server reads and writes the same Firestore document, so an extra
// instance does not grant another allowance. Closed windows are deleted here,
// and Firestore TTL on `expiresAt` removes anything the sweep misses.

import { createHash } from 'crypto';
import { AppError, getFirestoreDb } from '@/lib/app-backend-sdk';

export const RATE_LIMIT_MESSAGE = 'Too many requests. Please wait a moment and try again.';

const RATE_LIMITS = 'RateLimits';
const SWEEP_INTERVAL_MS = 30_000;
const SWEEP_LIMIT = 50;

type Counter = { count: number; resetAt: number };

const memoryLimits = new Map<string, Counter>();
let sweepAfter = 0;
let sweeping: Promise<void> | null = null;

function rateLimitDocumentId(key: string, maxCalls: number, windowMs: number): string {
  return createHash('sha256').update(`${windowMs}\0${maxCalls}\0${key}`).digest('hex');
}

function windowOpen(data: Partial<Counter> | undefined, now: number): data is Counter {
  return !!data
    && typeof data.count === 'number'
    && Number.isFinite(data.count)
    && typeof data.resetAt === 'number'
    && now < data.resetAt;
}

function consumeMemory(id: string, maxCalls: number, windowMs: number, now: number): boolean {
  for (const [key, entry] of memoryLimits) {
    if (now >= entry.resetAt) memoryLimits.delete(key);
  }
  const entry = memoryLimits.get(id);
  if (!windowOpen(entry, now)) {
    memoryLimits.set(id, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (entry.count >= maxCalls) return true;
  entry.count += 1;
  return false;
}

async function consumeShared(db: any, id: string, maxCalls: number, windowMs: number, now: number): Promise<boolean> {
  const ref = db.collection(RATE_LIMITS).doc(id);
  return db.runTransaction(async (tx: any) => {
    const data = (await tx.get(ref)).data() as Partial<Counter> | undefined;
    if (!windowOpen(data, now)) {
      const resetAt = now + windowMs;
      tx.set(ref, { count: 1, resetAt, expiresAt: new Date(resetAt) });
      return false;
    }
    if (data.count >= maxCalls) return true;
    tx.update(ref, { count: data.count + 1 });
    return false;
  });
}

/** Delete counters whose window has already closed. A refresh that won the race is left in place. */
export async function sweepExpiredRateLimits(db: any, now = Date.now()): Promise<number> {
  const snap = await db.collection(RATE_LIMITS).where('resetAt', '<', now).limit(SWEEP_LIMIT).get();
  let deleted = 0;
  for (const doc of snap.docs || []) {
    const removed = await db.runTransaction(async (tx: any) => {
      const data = (await tx.get(doc.ref)).data() as Partial<Counter> | undefined;
      if (!data || typeof data.resetAt !== 'number' || data.resetAt >= now) return false;
      tx.delete(doc.ref);
      return true;
    });
    if (removed) deleted += 1;
  }
  return deleted;
}

function scheduleExpiredSweep(db: any) {
  const now = Date.now();
  if (sweeping || now < sweepAfter) return;
  sweepAfter = now + SWEEP_INTERVAL_MS;
  sweeping = sweepExpiredRateLimits(db, now)
    .then(deleted => {
      if (deleted >= SWEEP_LIMIT) sweepAfter = 0;
    })
    .catch(error => {
      console.warn('[RateLimit] Expired counter cleanup failed', error instanceof Error ? error.message : 'unknown error');
    })
    .finally(() => {
      sweeping = null;
    });
}

type ConsumeOptions = {
  /** Firestore database. Null uses the process-local fallback outside production. */
  db?: any;
  now?: number;
  sweep?: boolean;
};

/**
 * Returns true when the caller is over the shared allowance.
 * The raw key is hashed and is not written to storage.
 */
export async function consumeRateLimit(
  key: string,
  maxCalls: number,
  windowMs: number,
  options: ConsumeOptions = {},
): Promise<boolean> {
  if (!Number.isFinite(maxCalls) || maxCalls < 1 || !Number.isFinite(windowMs) || windowMs < 1) return true;
  const explicitStore = options.db !== undefined;
  const db = explicitStore ? options.db : getFirestoreDb();
  const now = options.now ?? Date.now();
  const id = rateLimitDocumentId(key, maxCalls, windowMs);
  if (!db) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[RateLimit] Shared storage is unavailable; denying the request');
      return true;
    }
    return consumeMemory(id, maxCalls, windowMs, now);
  }

  try {
    const limited = await consumeShared(db, id, maxCalls, windowMs, now);
    if (options.sweep !== false) scheduleExpiredSweep(db);
    return limited;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    if (process.env.NODE_ENV === 'production' || explicitStore) {
      if (process.env.NODE_ENV === 'production') console.error('[RateLimit] Shared counter update failed', message);
      if (explicitStore) throw error;
      return true;
    }
    console.warn('[RateLimit] Shared counter update failed; using a process-local window', message);
    return consumeMemory(id, maxCalls, windowMs, now);
  }
}

export function rateLimitMemorySize(): number {
  return memoryLimits.size;
}

/**
 * Enforces a per-key rate limit. Rejects when the caller exceeds the allowed
 * number of calls within the window.
 */
export async function enforceRateLimit(
  key: string,
  maxCalls: number,
  windowMs: number,
  db?: any,
): Promise<void> {
  const limited = await consumeRateLimit(key, maxCalls, windowMs, db === undefined ? {} : { db, sweep: false });
  if (!limited) return;
  throw Object.assign(new AppError({
    code: 'TOO_MANY_REQUESTS',
    message: RATE_LIMIT_MESSAGE,
  }), {
    retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
  });
}

export async function isRateLimited(key: string, maxCalls: number, windowMs: number): Promise<boolean> {
  return consumeRateLimit(key, maxCalls, windowMs);
}
