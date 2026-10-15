import { getFirestoreDb } from './app-backend-sdk';
import { firestoreVersion, type RecordChange } from './realtimeQueryModel';
import { runAfterResponse } from './runAfterResponse';

/** Tell open dashboards that a document changed.
 * The request is submitted in a different browser from the admin's, so a
 * local UI event cannot reveal it. This advances the same per-query revision
 * the open list is already watching. */
const PUBLISH_BUDGET_MS = 2_000;

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime refresh is still running')), ms);
    work.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function publishNow(table: string, id: string, before?: Record<string, unknown> | null): Promise<void> {
  const db = getFirestoreDb();
  if (!db) return;
  const snapshot = await db.collection(table).doc(id).get();
  if (!snapshot.exists || !snapshot.updateTime) return;
  const { publishQueryChange } = await import('../../functions/src/publishQueryChange');
  const change: RecordChange = {
    table,
    id: snapshot.id,
    version: firestoreVersion(snapshot.updateTime),
    before: before || undefined,
    after: snapshot.data() as Record<string, unknown>,
  };
  await publishQueryChange(db, change);
}

export async function publishCollectionRevision(table: string, id: string, before?: Record<string, unknown> | null): Promise<void> {
  const collection = String(table || '').trim();
  const recordId = String(id || '').trim();
  if (!collection || !recordId) return;
  // The record is already saved. Subscriber fan-out must not leave the button
  // that saved it spinning, so it runs once the response has been sent.
  runAfterResponse('refresh open approval lists', () => withinBudget(publishNow(collection, recordId, before), PUBLISH_BUDGET_MS));
}

export async function publishUsersRevision(id: string, before?: Record<string, unknown> | null): Promise<void> {
  return publishCollectionRevision('Users', id, before);
}
