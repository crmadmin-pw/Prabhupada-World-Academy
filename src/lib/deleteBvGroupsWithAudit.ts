import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { ApiUserContext } from './apiAuthorization';
import { invalidateRequestTable } from './requestQueries';
import { serverCacheInvalidate } from './serverCache';

interface DeletionSelection {
  deleteAll?: boolean;
  groupIds?: string[];
  groupNames?: string[];
}

function references(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter(value => value != null).map(String);
}

/** Direct Admin SDK writes deliberately avoid the table adapter's memory fallback. */
export async function deleteBvGroupsWithAudit(db: Firestore, input: DeletionSelection, actor: ApiUserContext) {
  const audit = db.collection('auditLogs').doc();
  // A durable intent must exist before even planning destructive writes.
  await audit.create({
    action: 'hardDeleteBvGroups',
    entityType: 'BvGroups',
    entityId: input.deleteAll ? '*' : 'selected',
    actorUid: actor.uid,
    actorId: actor.id,
    actorEmail: actor.email,
    timestamp: FieldValue.serverTimestamp(),
    scope: input.deleteAll ? 'all' : 'selected',
    requestedGroupIds: input.groupIds || [],
    requestedGroupNames: input.groupNames || [],
    status: 'started',
  });

  try {
    const [groupsSnapshot, membershipsSnapshot] = await Promise.all([
      db.collection('BvGroups').select('groupId', 'groupName').get(),
      db.collection('BvGroupMembers').select('group', 'groupId').get(),
    ]);
    const ids = new Set(input.groupIds || []);
    const names = new Set(input.groupNames || []);
    const groups = groupsSnapshot.docs.filter(doc => input.deleteAll === true || ids.has(doc.id) || names.has(doc.data().groupName));
    const groupKeys = new Set(groups.flatMap(doc => [doc.id, ...references(doc.data().groupId)]));
    const memberships = membershipsSnapshot.docs.filter(doc => input.deleteAll === true ||
      [...references(doc.data().group), ...references(doc.data().groupId)].some(key => groupKeys.has(key)));

    // Memberships first. Include orphan memberships in a complete structure wipe.
    // Snapshot preconditions prevent deleting records changed since planning.
    const documents = [...memberships, ...groups];
    for (let offset = 0; offset < documents.length; offset += 400) {
      const chunk = documents.slice(offset, offset + 400);
      const batch = db.batch();
      for (const doc of chunk) batch.delete(doc.ref, { lastUpdateTime: doc.updateTime });
      // A receipt and its deletes are atomic. Even if the process stops or the
      // final status write fails, committed batches remain attributable.
      batch.create(audit.collection('batches').doc(String(offset / 400)), {
        timestamp: FieldValue.serverTimestamp(),
        deletedPaths: chunk.map(doc => doc.ref.path),
      });
      await batch.commit();
    }

    await audit.update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      deletedGroups: groups.length,
      deletedMemberships: memberships.length,
    });
    return {
      deleted: groups.length,
      details: [`Deleted ${groups.length} Bhakti Vriksha groups and ${memberships.length} memberships.`],
      auditId: audit.id,
    };
  } catch (error) {
    // Network errors may occur after a commit. Receipts, rather than local
    // counters, are authoritative when reconciling an interrupted operation.
    await audit.update({
      status: 'failed_or_partial',
      failedAt: FieldValue.serverTimestamp(),
    }).catch(() => console.error(`BV deletion audit ${audit.id}: status update failed; inspect batch receipts.`));
    throw error;
  } finally {
    invalidateRequestTable('BvGroups');
    invalidateRequestTable('BvGroupMembers');
    serverCacheInvalidate('bvslMembers:');
    serverCacheInvalidate('allBvGroupsAdmin:');
    serverCacheInvalidate('getBvGroupDetail:');
  }
}
