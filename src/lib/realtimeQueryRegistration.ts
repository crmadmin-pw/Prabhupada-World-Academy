import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from './app-backend-sdk';
import { dependencyTopics, stableValue, type QueryDependency } from './realtimeQueryModel';
import type { ApiUserContext } from './apiAuthorization';
import { REALTIME_SUBSCRIPTIONS, REALTIME_CLOCKS } from './realtimeCollections';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Parallel reads of one query share a transaction. The clock check still runs
 * inside that transaction, so a write that lands first remains visible. */
const COALESCE_MS = 10;

const USER_DEPENDENCY_FIELDS = [
  'role', 'roles', 'status', 'segment', 'guide', 'selectedGuide', 'residency',
  'reportingGuide', 'adminId', 'supervisorId', 'sadhanaMentor', 'sadhanaMentorId',
  'isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor', 'isBvMentor', 'isBvFacilitator',
  'isBvSubFacilitator', 'isBvsl', 'isSadhanaMentor', 'isServiceAllocator',
  'isCleanlinessManager', 'isFolkLead', 'isTripCoordinator',
  'isBvMember', 'bvGroupId', 'bvGroupName',
  'pendingRoleNotice', 'pendingBvGroupAssignmentNotice', 'pendingBvGroupRemovalNotice',
  'pendingBvApprovalNotice', 'pendingBvRejectionNotice', 'roleNoticeAcknowledged',
  'pendingAshrayNoticeStatus', 'pendingAshrayNoticeLevel', 'ashrayNoticeAcknowledged',
];

type Waiter = {
  readVersion: string;
  resolve: (value: { token: string; version: string }) => void;
  reject: (error: unknown) => void;
};

type Job = {
  db: any;
  uid: string;
  endpoint: string;
  token: string;
  readVersion: string;
  dependencies: QueryDependency[];
  waiters: Waiter[];
};

const pending = new Map<string, Job>();
const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function queryToken(user: ApiUserContext, endpoint: string, input: unknown): string {
  const { bypassCache: _bypass, _nocache: _noCache, ...queryInput } = (input || {}) as Record<string, unknown>;
  return digest(stableValue([user.uid, endpoint, queryInput]));
}

function normalizeDependencies(user: ApiUserContext, dependencies: QueryDependency[]): QueryDependency[] {
  // A changed role/status/assignment can revoke or expand an existing query.
  // Invalidate it through the same authenticated API, not a cached role claim.
  const withProfile: QueryDependency[] = [...dependencies, { table: 'Users', query: { id: user.id, fields: USER_DEPENDENCY_FIELDS } }];
  // Pagination and request deduplication can capture the same dependency
  // repeatedly. Limits/offsets do not narrow change matching; store it once.
  return [...new Map(withProfile.map(dependency => {
    const { id, filters, fields, sorts } = dependency.query;
    const normalized = { ...dependency, query: JSON.parse(JSON.stringify({ id, filters, fields, sorts })) };
    return [stableValue(normalized), normalized] as const;
  })).values()];
}

function unionDependencies(current: QueryDependency[], extra: QueryDependency[]): QueryDependency[] {
  return [...new Map([...current, ...extra].map(dependency => [stableValue(dependency), dependency] as const)).values()];
}

function prepare(
  user: ApiUserContext, endpoint: string, input: unknown,
  dependencies: QueryDependency[], readVersion: string, db = getFirestoreDb(),
): Omit<Job, 'waiters'> | undefined {
  if (!db || !user.uid || !readVersion || !dependencies.length) return;
  return {
    db, uid: user.uid, endpoint, readVersion,
    token: queryToken(user, endpoint, input),
    dependencies: normalizeDependencies(user, dependencies),
  };
}

function kick(token: string) {
  if (running.has(token) || timers.has(token)) return;
  const timer = setTimeout(() => {
    timers.delete(token);
    void run(token);
  }, COALESCE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(token, timer);
}

function enqueue(job: Omit<Job, 'waiters'>, waiter: Waiter) {
  const existing = pending.get(job.token);
  if (existing) {
    // The oldest read is the one a concurrent write can invalidate.
    if (job.readVersion < existing.readVersion) existing.readVersion = job.readVersion;
    existing.dependencies = unionDependencies(existing.dependencies, job.dependencies);
    existing.waiters.push(waiter);
    return;
  }
  pending.set(job.token, { ...job, waiters: [waiter] });
  kick(job.token);
}

async function commit(job: Job) {
  const { db, uid, endpoint, token, readVersion, dependencies } = job;
  const tables = [...new Set(dependencies.map(dependency => dependency.table))];
  const topics = [...new Set(dependencies.flatMap(dependencyTopics).map(digest))];
  const subscription = db.collection(REALTIME_SUBSCRIPTIONS).doc(token);
  const signal = db.collection('RealtimeClients').doc(uid).collection('queries').doc(token);
  const clocks = tables.map(table => db.collection(REALTIME_CLOCKS).doc(table));
  await db.runTransaction(async (transaction: any) => {
    const snapshots = await transaction.getAll(signal, ...clocks);
    let changedAfterRead = '';
    for (const snapshot of snapshots.slice(1)) {
      const version = String(snapshot.data()?.version || '');
      if (version > readVersion && version > changedAfterRead) changedAfterRead = version;
    }
    transaction.set(subscription, {
      uid, endpoint, dependencies: JSON.parse(JSON.stringify(dependencies)), topics,
      readVersion, updatedAt: Timestamp.now(), expiresAt: new Date(Date.now() + 30 * 86400_000),
    });
    // The collection clock closes the read/register race. A write worker
    // advances it BEFORE finding subscribers; this transaction either sees
    // that clock or commits before the worker finds this subscription.
    const existing = String(snapshots[0].data()?.version || '');
    if (!snapshots[0].exists || changedAfterRead > existing) {
      transaction.set(signal, { version: changedAfterRead || existing || readVersion });
    }
  });
}

async function run(token: string) {
  const job = pending.get(token);
  if (!job || running.has(token)) return;
  pending.delete(token);
  running.add(token);
  try {
    await commit(job);
    for (const waiter of job.waiters) waiter.resolve({ token, version: waiter.readVersion });
  } catch (error) {
    for (const waiter of job.waiters) waiter.reject(error);
  } finally {
    running.delete(token);
    if (pending.has(token)) kick(token);
  }
}

function start(job: Omit<Job, 'waiters'>): Promise<{ token: string; version: string }> {
  return new Promise((resolve, reject) => {
    enqueue(job, { readVersion: job.readVersion, resolve, reject });
  });
}

/** Receipt for the response. The Firestore transaction continues afterward. */
export function scheduleRealtimeQuery(
  user: ApiUserContext, endpoint: string, input: unknown,
  dependencies: QueryDependency[], readVersion: string,
  db = getFirestoreDb(),
): { token: string; version: string } | undefined {
  const job = prepare(user, endpoint, input, dependencies, readVersion, db);
  if (!job) return;
  void start(job).catch(error => console.warn('[Realtime] Query registration unavailable', error));
  return { token: job.token, version: job.readVersion };
}

/** Called only after the endpoint's capability checks and local guards pass.
 * Nothing in this private registry is readable or writable by client SDKs.
 * Resolves when the coalesced transaction that includes this read commits. */
export async function registerRealtimeQuery(
  user: ApiUserContext, endpoint: string, input: unknown,
  dependencies: QueryDependency[], readVersion: string,
  db = getFirestoreDb(),
): Promise<{ token: string; version: string } | undefined> {
  const job = prepare(user, endpoint, input, dependencies, readVersion, db);
  if (!job) return;
  return start(job);
}
