/**
 * Report reads for a known audience.
 *
 * A date-only scan pulls every department's rows and throws most of them away.
 * These helpers ask for the report's own user or group ids instead, in
 * Firestore-sized batches. A very large audience still uses one date scan,
 * because dozens of extra round trips would cost more than they save.
 */

const CHUNK = 30;
const PAGE = 2000;
const CONCURRENCY = 8;
export const SCOPED_OWNER_CAP = 900;

type Page = { records?: any[]; hasMore?: boolean };
type FindAll = (query: {
  filters?: Record<string, unknown>;
  fields?: string[];
  limit?: number;
  offset?: number;
}) => Promise<Page>;

export function collectOwnerKeys(users: readonly any[], fields: readonly string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    keys.push(text);
  };
  for (const user of users) {
    for (const field of fields) {
      const raw = user?.[field];
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        add(value);
        const text = String(value ?? '').trim();
        if (text) add(text.toLowerCase());
      }
    }
  }
  return keys;
}

async function readPages(findAll: FindAll, filters: Record<string, unknown>, fields?: string[]): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const query: { filters: Record<string, unknown>; fields?: string[]; limit: number; offset: number } = {
      filters, limit: PAGE, offset,
    };
    if (fields) query.fields = fields;
    const page = await findAll(query);
    const batch = page.records || [];
    rows.push(...batch);
    if (!page.hasMore || batch.length === 0) return rows;
    offset += batch.length;
  }
}

/** Every value is queried. Callers use this for group and member lists that must not fall back to a full scan. */
export async function findAllByIn(
  findAll: FindAll,
  field: string,
  values: readonly unknown[],
  filters: Record<string, unknown>,
  fields?: string[],
): Promise<any[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  if (unique.length === 0) return [];

  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += CHUNK) chunks.push(unique.slice(index, index + CHUNK));

  const records: any[] = [];
  const ids = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      let offset = 0;
      while (true) {
        const query: { filters: Record<string, unknown>; fields?: string[]; limit: number; offset: number } = {
          filters: { ...filters, [field]: { in: chunk } },
          limit: PAGE,
          offset,
        };
        if (fields) query.fields = fields;
        const page = await findAll(query);
        const batch = page.records || [];
        for (const record of batch) {
          const id = record?.id != null ? String(record.id) : '';
          if (id) {
            if (ids.has(id)) continue;
            ids.add(id);
          }
          records.push(record);
        }
        if (!page.hasMore || batch.length === 0) break;
        offset += batch.length;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, () => worker()));
  return records;
}

/** Prefer owner-scoped reads. Fall back to the date filters when the audience is huge. */
export async function readEntriesForOwners(
  findAll: FindAll,
  ownerValues: readonly string[],
  dateFilters: Record<string, unknown>,
  fields?: string[],
  ownerField = 'user',
): Promise<any[]> {
  if (ownerValues.length === 0) return [];
  if (ownerValues.length <= SCOPED_OWNER_CAP) {
    return findAllByIn(findAll, ownerField, ownerValues, dateFilters, fields);
  }
  return readPages(findAll, dateFilters, fields);
}
