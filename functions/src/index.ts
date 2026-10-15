import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { firestoreVersion } from '../../src/lib/realtimeQueryModel';
import { publishQueryChange } from './publishQueryChange';
import { publishNotification } from './publishNotification';
import { deletionVersion } from './deletionVersion';
import { expireQuery } from './expireQuery';
import { REALTIME_SUBSCRIPTIONS } from '../../src/lib/realtimeCollections';

initializeApp();

export const expireRealtimeQuery = onDocumentDeleted({
  document: `${REALTIME_SUBSCRIPTIONS}/{token}`, region: 'us-central1', retry: true, maxInstances: 5,
}, async event => {
  if (event.data) await expireQuery(getFirestore(), event.params.token, String(event.data.data()?.uid || ''));
});

export const synchronizeQueries = onDocumentWritten({
  document: '{collection}/{documentId}',
  // The existing database is nam5 (not the legacy location in firebase.json).
  region: 'us-central1', retry: true, maxInstances: 10,
}, async event => {
  const table = event.params.collection;
  // Synchronization metadata must never recursively generate more events.
  // RateLimits counters change on nearly every API request and no query reads them.
  if (table.startsWith('Realtime') || table === 'meta' || table === 'RateLimits' || !event.data) return;
  const after = event.data.after;
  const before = event.data.before;
  const version = after.exists && after.updateTime ? firestoreVersion(after.updateTime)
    : await deletionVersion(getFirestore(), event.id);
  const startedAt = Date.now();
  const metrics = await publishQueryChange(getFirestore(), {
    table, id: event.params.documentId, version,
    before: before.exists ? before.data() : undefined,
    after: after.exists ? after.data() : undefined,
  });
  if (table === 'NotificationBroadcasts' && after.exists) await publishNotification(getFirestore(), after.data()!);
  logger.info('realtime.change', { table, version, eventTime: event.time, operation: after.exists ? before.exists ? 'update' : 'create' : 'delete', ...metrics, durationMs: Date.now() - startedAt });
});
