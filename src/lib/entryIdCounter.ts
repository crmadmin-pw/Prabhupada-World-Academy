/**
 * Entry ID Counter — O(1) in-memory counter backed by the Config table.
 *
 * Problem solved: the old approach scanned the ENTIRE SadhanaEntries table on
 * every submission to find the highest ENTRY-N number — O(n) and getting
 * slower every day.
 *
 * How this works:
 *   1. First call: reads the last-known counter from the Config table (1 DB call)
 *   2. If Config has no value: falls back to scanning the DB once, then saves the result
 *   3. Every call: claims the next number in a Firestore transaction on that
 *      Config row, so concurrent server instances never issue the same ID
 *
 * Result: one small transaction per submission. O(n) at most ONCE ever per deploy.
 */
import { Config, SadhanaEntries, BvslPreachingEntries, getFirestoreDb } from '@/lib/backend-sdk';

const CONFIG_KEY_ENTRY = 'counter:sadhanaEntryN';
const CONFIG_KEY_BV    = 'counter:bvEntryN';

// Module-level state — persists for the lifetime of the server process
let sadhanaN: number | null = null;
let bvN: number | null = null;
let sadhanaConfigId: string | null = null;
let bvConfigId: string | null = null;

// Prevent concurrent init from racing
let sadhanaInitPromise: Promise<void> | null = null;
let bvInitPromise: Promise<void> | null = null;

// ── Scan helpers (used only once on cold start if Config row is missing) ──────

async function scanMaxSadhanaN(): Promise<number> {
  let maxN = 0; let offset = 0;
  while (true) {
    const { records, hasMore } = await SadhanaEntries.findAll({ fields: ['entryId'], offset, limit: 2000 });
    for (const r of records) {
      const m = (r.entryId || '').match(/^ENTRY-(\d+)$/i);
      if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
    }
    if (!hasMore) break;
    offset += records.length;
  }
  return maxN;
}

async function scanMaxBvN(): Promise<number> {
  let maxN = 0; let offset = 0;
  while (true) {
    const { records, hasMore } = await BvslPreachingEntries.findAll({ fields: ['entryId'], offset, limit: 2000 });
    for (const r of records) {
      const m = (r.entryId || '').match(/^BV-ENTRY-(\d+)$/i);
      if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
    }
    if (!hasMore) break;
    offset += records.length;
  }
  return maxN;
}

// ── Init helpers ──────────────────────────────────────────────────────────────

async function initSadhanaCounter(): Promise<void> {
  const rec = await Config.findOne({ filters: { configKey: CONFIG_KEY_ENTRY } });
  if (rec?.configValue) {
    const n = parseInt(rec.configValue, 10);
    if (!isNaN(n) && n > 0) {
      sadhanaN = n;
      sadhanaConfigId = rec.id;
      return;
    }
  }
  // Cold start: scan once
  const n = await scanMaxSadhanaN();
  sadhanaN = n;
  try {
    if (rec?.id) {
      // Update the existing (but empty/invalid) Config row
      await Config.update({ id: rec.id, record: { configValue: String(n), updatedAt: new Date().toISOString() } });
      sadhanaConfigId = rec.id;
    } else {
      const created = await Config.create({ record: { configKey: CONFIG_KEY_ENTRY, configValue: String(n), updatedAt: new Date().toISOString() } });
      sadhanaConfigId = created.id;
    }
  } catch { /* non-fatal — we'll still use the in-memory value */ }
}

async function initBvCounter(): Promise<void> {
  const rec = await Config.findOne({ filters: { configKey: CONFIG_KEY_BV } });
  if (rec?.configValue) {
    const n = parseInt(rec.configValue, 10);
    if (!isNaN(n) && n > 0) {
      bvN = n;
      bvConfigId = rec.id;
      return;
    }
  }
  const n = await scanMaxBvN();
  bvN = n;
  try {
    if (rec?.id) {
      await Config.update({ id: rec.id, record: { configValue: String(n), updatedAt: new Date().toISOString() } });
      bvConfigId = rec.id;
    } else {
      const created = await Config.create({ record: { configKey: CONFIG_KEY_BV, configValue: String(n), updatedAt: new Date().toISOString() } });
      bvConfigId = created.id;
    }
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Claims the next number from the shared Config counter. Several server
 * instances allocate concurrently, so a process-local count would repeat IDs.
 * Returns null when Firestore is unavailable. */
async function claimShared(configId: string | null, configKey: string, floor: number): Promise<number | null> {
  const db = getFirestoreDb();
  if (!db || !configId) return null;
  const ref = db.collection('Config').doc(configId);
  return db.runTransaction(async (tx: any) => {
    const stored = parseInt(String((await tx.get(ref)).data()?.configValue ?? ''), 10);
    const n = Math.max(Number.isFinite(stored) ? stored : 0, floor) + 1;
    tx.set(ref, { configKey, configValue: String(n), updatedAt: new Date().toISOString() }, { merge: true });
    return n;
  });
}

/** Returns the next unique ENTRY-N id. */
export async function nextSadhanaEntryId(): Promise<string> {
  if (sadhanaN === null) {
    if (!sadhanaInitPromise) sadhanaInitPromise = initSadhanaCounter();
    await sadhanaInitPromise;
    sadhanaInitPromise = null;
  }
  const n = await claimShared(sadhanaConfigId, CONFIG_KEY_ENTRY, sadhanaN ?? 0) ?? (sadhanaN ?? 0) + 1;
  sadhanaN = Math.max(sadhanaN ?? 0, n);
  return `ENTRY-${n}`;
}

/** Returns the next unique BV-ENTRY-N id. */
export async function nextBvEntryId(): Promise<string> {
  if (bvN === null) {
    if (!bvInitPromise) bvInitPromise = initBvCounter();
    await bvInitPromise;
    bvInitPromise = null;
  }
  const n = await claimShared(bvConfigId, CONFIG_KEY_BV, bvN ?? 0) ?? (bvN ?? 0) + 1;
  bvN = Math.max(bvN ?? 0, n);
  return `BV-ENTRY-${n}`;
}
