import { AsyncLocalStorage } from 'node:async_hooks';
import { firestoreVersion, type QueryDependency, type RealtimeRecordScope } from './realtimeQueryModel';

type Metrics = { count: number; rows: number; durationMs: number; deduplicated: number };
type RequestQueries = { pending: Map<string, Promise<unknown>>; hierarchyMemos: Map<string, Promise<unknown>>; metrics: Metrics; dependencies: Map<string, QueryDependency>; scopes: Map<string, RealtimeRecordScope>; readVersion: string; reactive: boolean };
const context = new AsyncLocalStorage<RequestQueries>();
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  // Firestore Timestamp, GeoPoint and reference values are immutable. Preserve
  // their prototypes (structuredClone would strip toDate/toMillis methods).
  return value;
}
function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

/** Only identical reads in ONE authorized request share a promise. No user data
 * or permission decision is shared with another request or server instance. */
export async function requestQuery<T>(table: string, operation: string, query: unknown, fetch: () => Promise<T>): Promise<T> {
  const request = context.getStore();
  if (!request) return fetch();
  const key = `${table}:${operation}:${stable(query)}`;
  const dependencyQuery = { ...((query || {}) as QueryDependency['query']) };
  // findOne({fields: []}) uses the adapter's full-document get(), unlike
  // findAll({fields: []}), which projects IDs only.
  if (operation === 'findOne' && dependencyQuery.fields?.length === 0 && dependencyQuery.id) delete dependencyQuery.fields;
  request.dependencies.set(key, { table, query: dependencyQuery });
  let pending = request.pending.get(key) as Promise<T> | undefined;
  if (pending) request.metrics.deduplicated++;
  else {
    pending = (async () => {
      const started = performance.now();
      try {
        const result = await fetch();
        request.metrics.rows += Array.isArray((result as any)?.records) ? (result as any).records.length : Number(!!result);
        return result;
      } finally {
        request.metrics.count++;
        request.metrics.durationMs += performance.now() - started;
      }
    })();
    request.pending.set(key, pending);
    pending.catch(() => request.pending.delete(key));
  }
  // Some reports sort/enrich their inputs in place; keep consumers isolated.
  return clone(await pending);
}

export function invalidateRequestTable(table: string) {
  const request = context.getStore();
  if (request) for (const key of request.pending.keys()) if (key.startsWith(`${table}:`)) request.pending.delete(key);
}

export function recordQueryReadTime(time: { seconds: number; nanoseconds: number } | undefined) {
  const request = context.getStore();
  if (!request || !time) return;
  const version = firestoreVersion(time);
  if (!request.readVersion || version < request.readVersion) request.readVersion = version;
}

export function isReactiveRequest(): boolean { return context.getStore()?.reactive === true; }

/** Scope promises for this request only. Absent outside a request, so one
 * caller's visibility cannot be reused for a later caller. */
export function requestHierarchyMemos(): Map<string, Promise<unknown>> | null {
  return context.getStore()?.hierarchyMemos ?? null;
}

/** Some legacy endpoints read broadly and filter in memory. Record that final
 * authorized scope without changing their historical database calculations.
 * Only use when every read of this table in the endpoint shares this scope. */
export function scopeRealtimeDependencies(table: string, scope: RealtimeRecordScope): void {
  context.getStore()?.scopes.set(table, scope);
}

export async function withRequestQueries<T>(run: () => Promise<T>, reactive = false) {
  const request: RequestQueries = { pending: new Map(), hierarchyMemos: new Map(), dependencies: new Map(), scopes: new Map(), readVersion: '', reactive, metrics: { count: 0, rows: 0, durationMs: 0, deduplicated: 0 } };
  const result = await context.run(request, run);
  return { result, metrics: request.metrics, dependencies: [...request.dependencies.values()].map(dependency => ({
    ...dependency, ...(request.scopes.has(dependency.table) ? { scope: request.scopes.get(dependency.table) } : {}),
  })), readVersion: request.readVersion };
}
