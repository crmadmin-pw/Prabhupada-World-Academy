import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirestoreDb } from './app-backend-sdk';
import { dependencyTopics, stableValue, type QueryDependency } from './realtimeQueryModel';
import type { ApiUserContext } from './apiAuthorization';
import { REALTIME_SUBSCRIPTIONS, REALTIME_CLOCKS } from './realtimeCollections';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Called only after the endpoint's capability checks and local guards pass.
 * Nothing in this private registry is readable or writable by client SDKs. */
export async function registerRealtimeQuery(
  user: ApiUserContext, endpoint: string, input: unknown,
  dependencies: QueryDependency[], readVersion: string,
): Promise<{ token: string; version: string } | undefined> {
  const db = getFirestoreDb();
  if (!db || !user.uid || !readVersion || !dependencies.length) return;
  const { bypassCache: _bypass, _nocache: _noCache, ...queryInput } = (input || {}) as Record<string, unknown>;
  // A changed role/status/assignment can revoke or expand an existing query.
  // Invalidate it through the same authenticated API, not a cached role claim.
  dependencies = [...dependencies, { table: 'Users', query: { id: user.id, fields: [
    'role', 'roles', 'status', 'segment', 'guide', 'selectedGuide', 'residency',
    'reportingGuide', 'adminId', 'supervisorId', 'sadhanaMentor', 'sadhanaMentorId',
    'isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor', 'isBvMentor', 'isBvFacilitator',
    'isBvSubFacilitator', 'isBvsl', 'isSadhanaMentor', 'isServiceAllocator',
    'isCleanlinessManager', 'isFolkLead', 'isTripCoordinator',
    'isBvMember', 'bvGroupId', 'bvGroupName',
    'pendingRoleNotice', 'pendingBvGroupAssignmentNotice', 'pendingBvGroupRemovalNotice',
    'pendingBvApprovalNotice', 'pendingBvRejectionNotice', 'roleNoticeAcknowledged',
    'pendingAshrayNoticeStatus', 'pendingAshrayNoticeLevel', 'ashrayNoticeAcknowledged',
  ] } }];
  const token = digest(stableValue([user.uid, endpoint, queryInput]));
  // Pagination and request deduplication can capture the same dependency
  // repeatedly. Limits/offsets do not narrow change matching; store it once.
  dependencies = [...new Map(dependencies.map(dependency => {
    const { id, filters, fields, sorts } = dependency.query;
    const normalized = { ...dependency, query: JSON.parse(JSON.stringify({ id, filters, fields, sorts })) };
    return [stableValue(normalized), normalized] as const;
  })).values()];
  const tables = [...new Set(dependencies.map(dependency => dependency.table))];
  const topics = [...new Set(dependencies.flatMap(dependencyTopics).map(digest))];
  const subscription = db.collection(REALTIME_SUBSCRIPTIONS).doc(token);
  const signal = db.collection('RealtimeClients').doc(user.uid).collection('queries').doc(token);
  const clocks = tables.map(table => db.collection(REALTIME_CLOCKS).doc(table));
  await db.runTransaction(async (transaction: any) => {
    const snapshots = await transaction.getAll(signal, ...clocks);
    let changedAfterRead = '';
    for (const snapshot of snapshots.slice(1)) {
      const version = String(snapshot.data()?.version || '');
      if (version > readVersion && version > changedAfterRead) changedAfterRead = version;
    }
    transaction.set(subscription, {
      uid: user.uid, endpoint, dependencies: JSON.parse(JSON.stringify(dependencies)), topics,
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
  return { token, version: readVersion };
}
