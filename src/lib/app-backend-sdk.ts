import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { requestQuery, invalidateRequestTable, recordQueryReadTime } from './requestQueries';
import { attachSharedCacheDatabase, serverCacheInvalidate } from './serverCache';
import { escapeEmailHtml, escapeHtml } from './sanitize';
import type { z } from 'zod';
import type { ApiCapability, ApiUserContext } from './apiAuthorization';

function invalidateTableReads(table: string, publish: boolean): Promise<void> {
  invalidateRequestTable(table);
  const tasks: Promise<void>[] = [];
  const drop = (prefix: string) => {
    const pending = serverCacheInvalidate(prefix, { publish });
    if (publish) tasks.push(pending);
  };
  if (table === 'Guides' || table === 'FolkResidencies') drop('reportReference:');
  if (table === 'FolkResidencies') drop('ref:residencies');
  if (table === 'Users' || table === 'Guides') drop('ref:guides');
  if (table === 'Services') drop('service_reference:');
  if (table === 'SadhanaFields') drop('sadhana_fields:');
  if (['Users', 'Guides', 'BvGroups', 'BvGroupMembers', 'BvAttendance'].includes(table)) drop('allBvGroupsAdmin:');
  return Promise.all(tasks).then(() => undefined);
}

// ══════════════════════════════════════════════════════════════════════════════
// app-backend-sdk.ts — Server-side Firebase Firestore Integration Layer.
// Provides data models, ORM operations, and email services.
// ══════════════════════════════════════════════════════════════════════════════

let firestoreDb: any = null;
let _hasValidCredentials = false;

export function getFirestoreDb(): any {
  if (!_hasValidCredentials) return null;
  return firestoreDb;
}

function initFirestoreOnStartup() {
  try {
    const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
    let hasKey = false;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'bvpw108';

    if (fs.existsSync(serviceAccountPath)) {
      try {
        const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        if (sa.private_key && sa.private_key.includes('BEGIN') && !sa.private_key.includes('dummy')) {
          if (getApps().length === 0) {
            initializeApp({ credential: cert(sa), projectId: sa.project_id || projectId });
          }
          hasKey = true;
        }
      } catch (e) {}
    }

    if (!hasKey && process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (sa.private_key && sa.private_key.includes('BEGIN') && !sa.private_key.includes('dummy')) {
          if (getApps().length === 0) {
            initializeApp({ credential: cert(sa), projectId: sa.project_id || projectId });
          }
          hasKey = true;
        }
      } catch (e) {}
    }

    if (hasKey || (typeof process !== 'undefined' && !!process.env?.FIRESTORE_EMULATOR_HOST)) {
      _hasValidCredentials = true;
      if (getApps().length === 0) {
        initializeApp({ projectId });
      }
      firestoreDb = getFirestore();
      try {
        firestoreDb.settings({ ignoreUndefinedProperties: true });
      } catch (e) {}
    } else {
      // Fallback: try Application Default Credentials (ADC) only in production.
      // Firebase App Hosting automatically injects ADC at runtime so the
      // server can connect to Firestore without a service account key file.
      if (process.env.NODE_ENV === 'production') {
        try {
          if (getApps().length === 0) {
            initializeApp({ credential: applicationDefault(), projectId });
          }
          firestoreDb = getFirestore();
          firestoreDb.settings({ ignoreUndefinedProperties: true });
          _hasValidCredentials = true;
          console.log('[Firebase Admin] Initialized using Application Default Credentials (App Hosting ADC).');
        } catch (adcError: any) {
          _hasValidCredentials = false;
          firestoreDb = null;
          console.error('❌ CRITICAL ERROR: Firebase Service Account credentials not found or invalid in production environment!', adcError?.message);
        }
      } else {
        _hasValidCredentials = false;
        firestoreDb = null;
      }
    }

  } catch (e: any) {
    _hasValidCredentials = false;
    firestoreDb = null;
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ CRITICAL ERROR: Firebase initialization failed in production environment:', e);
    }
  }
}

initFirestoreOnStartup();
attachSharedCacheDatabase(getFirestoreDb);

interface EndpointDefinition<Input extends z.ZodType, Output extends z.ZodType, Result, Public extends boolean> {
  description: string;
  authenticated?: boolean;
  public?: Public;
  publicSecretEnv?: string;
  maxBodyBytes?: number;
  webhook?: Record<string, unknown>;
  requiredCapabilities?: ApiCapability | ApiCapability[];
  inputSchema: Input;
  outputSchema: Output;
  execute(args: { input: z.output<Input>; context: { user: Public extends true ? ApiUserContext | null : ApiUserContext } }): Promise<Result>;
}

/** Preserve the parsed input and actual handler result throughout the client SDK. */
export function createEndpoint<Input extends z.ZodType, Output extends z.ZodType, Result, Public extends boolean = false>(
  config: EndpointDefinition<Input, Output, Result, Public>,
) {
  return config;
}

export class AppError extends Error {
  code: string;
  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

function applyFilters(ref: any, filters: any) {
  let q = ref;
  for (const col of Object.keys(filters)) {
    const val = filters[col];
    if (val === undefined) continue;

    const dbField = col === 'id' ? FieldPath.documentId() : col;

    if (val === null) {
      q = q.where(dbField, '==', null);
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const keys = Object.keys(val);
      for (const op of keys) {
        const opVal = val[op];
        if (op === 'in') {
          if (Array.isArray(opVal) && opVal.length > 0) {
            q = q.where(dbField, 'in', opVal.slice(0, 30));
          } else {
            q = q.where(dbField, '==', '__EMPTY_QUERY_RESULT__');
          }
        } else if (op === 'arrayContainsAny' || op === 'array-contains-any') {
          if (Array.isArray(opVal) && opVal.length > 0) {
            q = q.where(dbField, 'array-contains-any', opVal.slice(0, 10));
          } else {
            q = q.where(dbField, '==', '__EMPTY_QUERY_RESULT__');
          }
        } else if (op === 'arrayContains' || op === 'array-contains') {
          q = q.where(dbField, 'array-contains', opVal);
        } else if (op === 'notIn' || op === 'not_in') {
          if (Array.isArray(opVal) && opVal.length > 0) {
            q = q.where(dbField, 'not-in', opVal.slice(0, 30));
          }
        } else if (op === 'gte') {
          q = q.where(dbField, '>=', opVal);
        } else if (op === 'lte') {
          q = q.where(dbField, '<=', opVal);
        } else if (op === 'gt') {
          q = q.where(dbField, '>', opVal);
        } else if (op === 'lt') {
          q = q.where(dbField, '<', opVal);
        } else if (op === 'neq' || op === 'ne') {
          q = q.where(dbField, '!=', opVal);
        }
      }
    } else {
      q = q.where(dbField, '==', val);
    }
  }
  return q;
}

/**
 * Apply a Firestore projection when callers request a field subset.
 *
 * Every record already receives its document ID from `doc.id`, so selecting a
 * stored `id` field is unnecessary.  Firestore projections substantially cut
 * response size for collections such as SadhanaEntries, whose documents also
 * contain large JSON payloads that most dashboard queries never use.
 */
function applyFieldSelection(ref: any, fields: unknown): any {
  if (!Array.isArray(fields)) return ref;
  const selected = [...new Set(
    fields.filter((field): field is string => typeof field === 'string' && field.length > 0 && field !== 'id')
  )];
  // `select()` with no field arguments is valid and returns document IDs only.
  return ref.select(...selected);
}

function parseCSVText(text: string): Record<string, string>[] {
  const lines: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { inQuotes = !inQuotes; cur += c; }
    else if (c === '\n' && !inQuotes) { lines.push(cur); cur = ''; }
    else { cur += c; }
  }
  if (cur.trim()) lines.push(cur);
  if (lines.length < 2) return [];

  function splitLine(line: string) {
    const fields: string[] = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (q && line[i + 1] === '"') { field += '"'; i++; }
        else { q = !q; }
      } else if (char === ',' && !q) {
        fields.push(field.trim());
        field = '';
      } else { field += char; }
    }
    fields.push(field.trim());
    return fields;
  }

  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] !== undefined ? vals[idx] : ''; });
    return row;
  });
}

function loadCsvTableData(tableName: string): any[] {
  try {
    let dir = path.resolve(process.cwd(), 'docs/app-backups');
    if (!fs.existsSync(dir)) {
      dir = path.resolve(process.cwd(), 'docs/zite-backups');
    }
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv') && !f.includes(':Zone.Identifier'));
    const match = files.find(f => {
      const name = f.split(' - Grid view')[0].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const target = tableName.toLowerCase().replace(/[^a-z0-9]/g, '');
      return name === target || name.replace(/s$/, '') === target.replace(/s$/, '');
    });
    if (!match) return [];
    const content = fs.readFileSync(path.join(dir, match), 'utf8');
    const rawRows = parseCSVText(content);

    return rawRows.map(r => {
      const obj: Record<string, any> = { _raw: r };
      for (const [k, v] of Object.entries(r)) {
        if (!k) continue;
        const camelKey = k
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .trim()
          .split(/\s+/)
          .map((w, idx) => idx === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join('');

        let val: any = v;
        if (v === 'true') val = true;
        else if (v === 'false') val = false;
        else if (v.trim() === '') val = null;

        obj[camelKey] = val;
      }

      // Ensure standard entity fields
      if (r['ID']) obj.id = r['ID'];
      if (r['User ID']) obj.userId = r['User ID'];
      if (r['Full Name']) obj.fullName = r['Full Name'];
      if (r['Email']) obj.email = r['Email'];
      if (r['Phone']) obj.phone = r['Phone'];
      if (r['Role']) obj.role = r['Role'];
      if (r['Status']) obj.status = r['Status'];
      if (r['Guide ID']) obj.guideId = r['Guide ID'];
      if (r['Guide']) obj.guideName = r['Guide'];
      if (r['Residency']) obj.residencyName = r['Residency'];
      if (r['Ashray Level']) obj.ashrayLevel = r['Ashray Level'];
      if (r['Abbreviation']) obj.abbr = r['Abbreviation'];
      if (r['Is Active'] !== undefined) obj.isActive = r['Is Active'] === 'true';

      return obj;
    });
  } catch (e) {
    return [];
  }
}

const mockStore: Record<string, Map<string, any>> = {};

function getMockTable(tableName: string): Map<string, any> {
  if (!mockStore[tableName]) {
    mockStore[tableName] = new Map<string, any>();

    // Safeguard: Prevent mock data from leaking in production
    if (process.env.NODE_ENV === 'production') {
      console.warn(`[App SDK] Warning: Firebase credentials not found in production. Mock data for table '${tableName}' is disabled for security.`);
      return mockStore[tableName];
    }

    const csvRecords = loadCsvTableData(tableName);
    csvRecords.forEach(rec => {
      const docId = rec.id || rec.userId || rec.email || rec.guideId || String(mockStore[tableName].size + 1);
      mockStore[tableName].set(docId, rec);
      if (rec.id) mockStore[tableName].set(rec.id, rec);
      if (rec.userId) mockStore[tableName].set(rec.userId, rec);
      if (rec.email) mockStore[tableName].set(rec.email.toLowerCase(), rec);
    });

    // Development fixtures must be created explicitly by tests or loaded from
    // CSV backups. Runtime demo identities can make an unregistered email look
    // like a real user, so they are intentionally not seeded here.
  }
  return mockStore[tableName];
}

function hasWorkingFirestore(): boolean {
  if (typeof process !== 'undefined' && process.env?.FIRESTORE_EMULATOR_HOST) return true;
  return _hasValidCredentials;
}

let firestoreForTests: any | undefined;

/** Point table operations at a stand-in client. Tests use this to simulate a
 * missing index or a failed delete without a live Firestore. */
export function setFirestoreForTests(db: any | undefined): void {
  firestoreForTests = db;
}

function activeDb(): any {
  if (firestoreForTests !== undefined) return firestoreForTests;
  return hasWorkingFirestore() ? getFirestoreDb() : null;
}

function ensureFirestoreInProduction() {
  if (process.env.NODE_ENV === 'production' && !hasWorkingFirestore()) {
    throw new Error('Database Connection Error: Real Cloud Firestore is not configured. Please verify your Firebase Service Account credentials.');
  }
}

function databaseOperationError(operation: 'read' | 'delete', tableName: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Database ${operation} failed for ${tableName}: ${detail}`, { cause: error });
}

function outsideRange(actual: unknown, op: 'gte' | 'lte' | 'gt' | 'lt', expected: unknown): boolean {
  if (expected === undefined || expected === null) return false;
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (op === 'gte') return actual < expected;
    if (op === 'lte') return actual > expected;
    if (op === 'gt') return actual <= expected;
    return actual >= expected;
  }
  const left = String(actual ?? '');
  const right = String(expected);
  if (op === 'gte') return left < right;
  if (op === 'lte') return left > right;
  if (op === 'gt') return left <= right;
  return left >= right;
}

export class Table {
  tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  private matchMock(item: any, filters: any): boolean {
    if (!filters) return true;
    for (const key of Object.keys(filters)) {
      const val = filters[key];
      if (val === undefined) continue;
      if (val === null) {
        if (item[key] !== null && item[key] !== undefined) return false;
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        if (val.in && Array.isArray(val.in)) {
          if (!val.in.includes(item[key])) return false;
        }
        const contained = val.arrayContainsAny || val['array-contains-any'];
        if (Array.isArray(contained)) {
          const actual = [item[key]].flat().filter(value => value != null).map(value => String(value).toLowerCase());
          if (!contained.some((value: unknown) => actual.includes(String(value).toLowerCase()))) return false;
        }
        if (outsideRange(item[key], 'gte', val.gte)) return false;
        if (outsideRange(item[key], 'lte', val.lte)) return false;
        if (outsideRange(item[key], 'gt', val.gt)) return false;
        if (outsideRange(item[key], 'lt', val.lt)) return false;
      } else {
        if (key === 'guide' || key === 'guideId' || key === 'selectedGuideId') {
          const itemVal = String(item.guide || item.guideName || item.selectedGuideId || '').toLowerCase();
          const filterVal = String(val).toLowerCase();
          if (itemVal && filterVal && itemVal !== filterVal && !itemVal.includes(filterVal) && !filterVal.includes(itemVal)) {
            return false;
          }
        } else {
          if (String(item[key] || '').toLowerCase() !== String(val || '').toLowerCase()) {
            return false;
          }
        }
      }
    }
    return true;
  }

  async findOne(query: any): Promise<any> {
    return requestQuery(this.tableName, 'findOne', query, () => this.findOneUncached(query));
  }

  private async findOneUncached(query: any): Promise<any> {
    ensureFirestoreInProduction();
    const db = activeDb();
    if (db) {
      try {
        if (query.id) {
          if (Array.isArray(query.fields) && query.fields.length > 0) {
            let q = db.collection(this.tableName)
              .where(FieldPath.documentId(), '==', query.id);
            q = applyFieldSelection(q, query.fields);
            const snapshot = await q.limit(1).get();
            recordQueryReadTime(snapshot.readTime);
            if (!snapshot.empty) {
              return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
            }
          } else {
            const doc = await db.collection(this.tableName).doc(query.id).get();
            recordQueryReadTime(doc.readTime);
            if (doc.exists) return { id: doc.id, ...doc.data() };
          }
        } else if (query.filters) {
          let q = db.collection(this.tableName);
          q = applyFilters(q, query.filters);
          q = applyFieldSelection(q, query.fields);
          const snapshot = await q.limit(1).get();
          recordQueryReadTime(snapshot.readTime);
          if (!snapshot.empty) {
            return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
          }
        }
      } catch (e: unknown) {
        // Same rule as findAll: a failed read is an error, not "no data".
        throw databaseOperationError('read', this.tableName, e);
      }
    }

    const store = getMockTable(this.tableName);
    if (query.id) {
      return store.get(query.id);
    }
    if (query.filters) {
      for (const item of Array.from(store.values())) {
        if (this.matchMock(item, query.filters)) return item;
      }
    }
    return undefined;
  }

  async findAll(query: any = {}): Promise<{ records: any[]; hasMore: boolean }> {
    return requestQuery(this.tableName, 'findAll', query, () => this.findAllUncached(query));
  }

  private async findAllUncached(query: any = {}): Promise<{ records: any[]; hasMore: boolean }> {
    ensureFirestoreInProduction();
    const db = activeDb();
    if (db) {
      try {
        let q = db.collection(this.tableName);

        if (query.id) {
          q = q.where(FieldPath.documentId(), '==', query.id);
        } else if (query.filters) {
          q = applyFilters(q, query.filters);
        }

        if (query.sorts && Array.isArray(query.sorts) && query.sorts.length > 0) {
          query.sorts.forEach((s: any) => {
            q = q.orderBy(s.field, s.dir.toLowerCase() as 'asc' | 'desc');
          });
        }

        q = applyFieldSelection(q, query.fields);

        const limit = query.limit ? Number(query.limit) : null;
        const offset = query.offset ? Number(query.offset) : null;

        if (limit !== null) {
          q = q.limit(limit + 1);
        }

        if (offset !== null) {
          q = q.offset(offset);
        }

        const snapshot = await q.get();
        recordQueryReadTime(snapshot.readTime);
        const records = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        let hasMore = false;
        if (limit !== null && records.length > limit) {
          hasMore = true;
          records.pop();
        }

        return {
          records,
          hasMore,
        };
      } catch (e: unknown) {
        // A missing index or any other Firestore failure must not look like an
        // empty collection. The in-memory store is only for environments
        // without Firestore.
        throw databaseOperationError('read', this.tableName, e);
      }
    }

    const store = getMockTable(this.tableName);
    let records = Array.from(new Set(store.values()));

    if (query.id) {
      records = records.filter(r => r.id === query.id || r.userId === query.id || (r.email || '').toLowerCase() === String(query.id).toLowerCase());
    } else if (query.filters) {
      records = records.filter(r => this.matchMock(r, query.filters));
    }

    if (Array.isArray(query.sorts) && query.sorts.length > 0) {
      const sorts = query.sorts;
      records.sort((a, b) => {
        for (const sort of sorts) {
          const direction = String(sort?.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
          const left = a?.[sort.field];
          const right = b?.[sort.field];
          if (left === right) continue;
          if (typeof left === 'number' && typeof right === 'number') {
            return left < right ? -direction : direction;
          }
          const compared = String(left ?? '').localeCompare(String(right ?? ''));
          if (compared !== 0) return compared * direction;
        }
        return 0;
      });
    }

    const offset = query.offset ? Number(query.offset) : 0;
    const windowed = offset > 0 ? records.slice(offset) : records;
    const limit = query.limit ? Number(query.limit) : null;
    if (limit === null) return { records: windowed, hasMore: false };
    return { records: windowed.slice(0, limit), hasMore: windowed.length > limit };
  }

  async create({ record }: { record: any }): Promise<any> {
    invalidateTableReads(this.tableName, false);
    try { return await this.createUncached({ record }); }
    finally { await invalidateTableReads(this.tableName, true); }
  }

  private async createUncached({ record }: { record: any }): Promise<any> {
    ensureFirestoreInProduction();
    const id = record.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
    const fullRecord = { ...record, id };

    const db = activeDb();
    if (db) {
      try {
        await db.collection(this.tableName).doc(id).set(fullRecord);
      } catch (e: any) {
        // A production write must never silently fall back to process memory:
        // it is discarded on the next request while the caller sees success.
        if (process.env.NODE_ENV === 'production') {
          throw new Error(`Database write failed for ${this.tableName}: ${e?.message || e}`);
        }
        console.warn(`[Table ${this.tableName}] Firestore create error (${e?.message || e}), saved to local memory store.`);
      }
    }

    const store = getMockTable(this.tableName);
    store.set(id, fullRecord);
    if (fullRecord.userId) store.set(fullRecord.userId, fullRecord);
    if (fullRecord.email) store.set(fullRecord.email.toLowerCase(), fullRecord);
    await noteHierarchyWrite(this.tableName, fullRecord);
    return fullRecord;
  }

  async update({ id, record }: { id: string; record: any }): Promise<any> {
    invalidateTableReads(this.tableName, false);
    try { return await this.updateUncached({ id, record }); }
    finally { await invalidateTableReads(this.tableName, true); }
  }

  private async updateUncached({ id, record }: { id: string; record: any }): Promise<any> {
    ensureFirestoreInProduction();
    const data: any = {};
    for (const key of Object.keys(record)) {
      if (record[key] !== undefined) {
        data[key] = record[key];
      }
    }

    const db = activeDb();
    if (db) {
      try {
        await db.collection(this.tableName).doc(id).set(data, { merge: true });
      } catch (e: any) {
        // See create(): production callers need a real failure, not a false
        // success backed only by temporary server memory.
        if (process.env.NODE_ENV === 'production') {
          throw new Error(`Database update failed for ${this.tableName}: ${e?.message || e}`);
        }
        console.warn(`[Table ${this.tableName}] Firestore update error (${e?.message || e}), updated local memory store.`);
      }
    }

    const store = getMockTable(this.tableName);
    let existing = store.get(id);
    if (!existing && id) {
      existing = Array.from(store.values()).find((r: any) =>
        r.id === id || r.userId === id || (r.email || '').toLowerCase() === String(id).toLowerCase()
      );
    }
    if (!existing) {
      existing = { id };
    }

    Object.assign(existing, data);

    if (existing.id) store.set(existing.id, existing);
    if (existing.userId) store.set(existing.userId, existing);
    if (existing.email) store.set(existing.email.toLowerCase(), existing);

    await noteHierarchyWrite(this.tableName, data);
    return existing;
  }

  async delete({ id }: { id: string }): Promise<any> {
    invalidateTableReads(this.tableName, false);
    try { return await this.deleteUncached({ id }); }
    finally { await invalidateTableReads(this.tableName, true); }
  }

  private async deleteUncached({ id }: { id: string }): Promise<any> {
    ensureFirestoreInProduction();
    let record: any = null;
    const db = activeDb();
    if (db) {
      record = await this.findOne({ id });
      if (record) {
        try {
          await db.collection(this.tableName).doc(id).delete();
        } catch (e: unknown) {
          // Create and update already fail the request. A failed delete must
          // not continue into the memory store and return the record as if it
          // were gone.
          throw databaseOperationError('delete', this.tableName, e);
        }
      }
    }

    const store = getMockTable(this.tableName);
    const existing = store.get(id) || Array.from(store.values()).find((r: any) =>
      r.id === id || r.userId === id || (r.email || '').toLowerCase() === String(id).toLowerCase()
    );
    if (existing) {
      for (const [key, val] of store.entries()) {
        if (val === existing) {
          store.delete(key);
        }
      }
    } else {
      store.delete(id);
    }
    await noteHierarchyWrite(this.tableName);
    return existing || record;
  }

  async bulkCreate({ records, matchOn }: { records: any[]; matchOn?: string[] }): Promise<{ records: any[] }> {
    const results: any[] = [];
    for (const r of records) {
      const res = await this.create({ record: r });
      results.push(res);
    }
    return { records: results };
  }
}

const REPORTING_CHAIN_TABLES = new Set(['Users', 'Guides', 'BvGroups', 'BvGroupMembers', 'FolkResidencies']);
const REPORTING_CHAIN_USER_FIELDS = new Set([
  'role', 'guide', 'selectedGuideId', 'segment', 'isPrabhupadaWorldUser', 'status',
  'bvReportingAdminId', 'bvReportingSupervisorId', 'bvReportingFacilitatorId', 'bvSupervisorGuideId',
  'sadhanaMentor', 'folkResidencies', 'residency',
  'isBvAdmin', 'isBvSuperAdmin', 'isPwAdmin', 'isBvSupervisor', 'isBvMentor',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator', 'isSadhanaMentor',
  'userId', 'email',
]);
export const REPORTING_CHAINS_KEY = 'reportingChainsVersion';
export const REPORTING_CHAINS_READY = 'ready:1';

let reportingChainsLocallyStale = false;

export function reportingChainsLocallyStaleNow(): boolean {
  return reportingChainsLocallyStale;
}

export function clearReportingChainsLocalStale(): void {
  reportingChainsLocallyStale = false;
}

export async function markReportingChainsStale(): Promise<void> {
  reportingChainsLocallyStale = true;
  try {
    await Config.update({
      id: REPORTING_CHAINS_KEY,
      record: {
        configKey: REPORTING_CHAINS_KEY,
        configValue: `stale:${Date.now()}`,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch {
    // This instance still rebuilds on the next scoped read. Other instances
    // keep the previous chains until a later invalidation is stored.
  }
}

async function noteHierarchyWrite(tableName: string, record?: Record<string, unknown>) {
  if (!REPORTING_CHAIN_TABLES.has(tableName)) return;
  if (tableName === 'Users' && record && !Object.keys(record).some(key => REPORTING_CHAIN_USER_FIELDS.has(key))) return;
  await markReportingChainsStale();
}

function safeMailHeader(value: unknown): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function safeMailHref(value: unknown): string {
  const href = String(value ?? '').trim();
  if (/[\r\n\0]/.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/[A-Za-z0-9]/.test(href)) return href;
  return '';
}

function safeMailBody(body: unknown): unknown[] {
  if (!Array.isArray(body)) return [];
  return body.map(part => {
    if (!part || typeof part !== 'object') return part;
    const next = { ...(part as Record<string, unknown>) };
    if (typeof next.content === 'string') next.content = escapeEmailHtml(next.content);
    if (typeof next.label === 'string') next.label = escapeHtml(sanitizeMailLabel(next.label));
    if (typeof next.href === 'string') next.href = safeMailHref(next.href);
    return next;
  });
}

function sanitizeMailLabel(label: string): string {
  return label.replace(/[\r\n\0]/g, ' ');
}

// ─── EMAIL CLIENT MOCK ────────────────────────────────────────────────────────
export const Email = {
  send: async (params: { to: string; subject: string; body: any[] }) => {
    const message = {
      to: safeMailHeader(params.to),
      subject: safeMailHeader(params.subject),
      body: safeMailBody(params.body),
    };
    console.log(`[Email Mock] Sending to: ${message.to}`);
    console.log(`[Email Mock] Subject: ${message.subject}`);
    console.log(`[Email Mock] Body:`, JSON.stringify(message.body, null, 2));
    // In production, configure nodemailer/SMTP here.
    return { success: true };
  }
};

// ─── INSTANTIATE & EXPORT ALL TABLES ──────────────────────────────────────────
export const AccountDeletionHolds = new Table('AccountDeletionHolds');
export const AccountLinkRequests = new Table('AccountLinkRequests');
export const AshrayChecklist = new Table('AshrayChecklist');
export const AshrayLevels = new Table('AshrayLevels');
export const AshrayUpgradeRequests = new Table('AshrayUpgradeRequests');
export const AttendanceEvents = new Table('AttendanceEvents');
export const AttendanceParticipants = new Table('AttendanceParticipants');
export const AttendanceRecords = new Table('AttendanceRecords');
export const AttendanceSessions = new Table('AttendanceSessions');
export const AttendanceVolunteers = new Table('AttendanceVolunteers');
export const BvAttendance = new Table('BvAttendance');
export const BvGroupMembers = new Table('BvGroupMembers');
export const BvGroupRequests = new Table('BvGroupRequests');
export const BvGroups = new Table('BvGroups');
export const BvMemberRegistrations = new Table('BvMemberRegistrations');
export const BvQuizSubmissions = new Table('BvQuizSubmissions');
export const BvQuizzes = new Table('BvQuizzes');
export const BvSessions = new Table('BvSessions');
export const BvslPreachingEntries = new Table('BvslPreachingEntries');
export const BvslWeeklyPlans = new Table('BvslWeeklyPlans');
export const ChallengeEnrollments = new Table('ChallengeEnrollments');
export const CleanlinessInspections = new Table('CleanlinessInspections');
export const CleanlinessReviewRequests = new Table('CleanlinessReviewRequests');
export const CleanlinessRooms = new Table('CleanlinessRooms');
export const Config = new Table('Config');
export const FolkResidencies = new Table('FolkResidencies');
export const GuideTransferRequests = new Table('GuideTransferRequests');
export const GuideResidencyAssignmentRequests = new Table('GuideResidencyAssignmentRequests');
export const Guides = new Table('Guides');
export const JigyasaProcessedFiles = new Table('JigyasaProcessedFiles');
export const JigyasaRegistrations = new Table('JigyasaRegistrations');
export const JigyasaSessionAttendance = new Table('JigyasaSessionAttendance');

export const OneToOneMeetings = new Table('OneToOneMeetings');
export const PreachingReportGoals = new Table('PreachingReportGoals');
export const PushSubscriptions = new Table('PushSubscriptions');
export const RentPayments = new Table('RentPayments');
export const ResidencyTransferRequests = new Table('ResidencyTransferRequests');
export const SadhanaEntries = new Table('SadhanaEntries');
export const SadhanaFields = new Table('SadhanaFields');
export const SadhanaFieldsTable = SadhanaFields;
export const SadhanaMonthlySummaries = new Table('SadhanaMonthlySummaries');
export const SadhanaPeriodSummaries = new Table('SadhanaPeriodSummaries');
export const SadhanaPeriodSummaryMeta = new Table('SadhanaPeriodSummaryMeta');
export const ServiceAllocations = new Table('ServiceAllocations');
export const ServiceAvailability = new Table('ServiceAvailability');
export const ServicePreferences = new Table('ServicePreferences');
export const ServiceRatings = new Table('ServiceRatings');
export const ServiceSwaps = new Table('ServiceSwaps');
export const Services = new Table('Services');
export const SkillCatalog = new Table('SkillCatalog');
export const TagMangoSyncLog = new Table('TagMangoSyncLog');
export const Trips = new Table('Trips');
export const UnavailabilityRequests = new Table('UnavailabilityRequests');
export const UserSkills = new Table('UserSkills');
export const Meetings = new Table('Meetings');
export const MinutesOfMeeting = new Table('MinutesOfMeeting');
export const Users = new Table('Users');
