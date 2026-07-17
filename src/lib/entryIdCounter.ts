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
 *   3. All subsequent calls: pure in-memory increment — zero DB calls
 *   4. After each use: updates Config async (fire-and-forget) so restarts resume correctly
 *
 * Result: O(1) on every submission after warm-up. O(n) at most ONCE ever per deploy.
 */
import { Config, SadhanaEntries, BvslPreachingEntries } from 'zite-integrations-backend-sdk';

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

/** Returns the next unique ENTRY-N id. O(1) after first call. */
export async function nextSadhanaEntryId(): Promise<string> {
  if (sadhanaN === null) {
    if (!sadhanaInitPromise) sadhanaInitPromise = initSadhanaCounter();
    await sadhanaInitPromise;
    sadhanaInitPromise = null;
  }
  sadhanaN = (sadhanaN ?? 0) + 1;
  const n = sadhanaN;
  // Persist async — never block the submission
  if (sadhanaConfigId) {
    Config.update({ id: sadhanaConfigId, record: { configValue: String(n), updatedAt: new Date().toISOString() } }).catch(() => {});
  }
  return `ENTRY-${n}`;
}

/** Returns the next unique BV-ENTRY-N id. O(1) after first call. */
export async function nextBvEntryId(): Promise<string> {
  if (bvN === null) {
    if (!bvInitPromise) bvInitPromise = initBvCounter();
    await bvInitPromise;
    bvInitPromise = null;
  }
  bvN = (bvN ?? 0) + 1;
  const n = bvN;
  if (bvConfigId) {
    Config.update({ id: bvConfigId, record: { configValue: String(n), updatedAt: new Date().toISOString() } }).catch(() => {});
  }
  return `BV-ENTRY-${n}`;
}
