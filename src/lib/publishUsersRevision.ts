import { getFirestoreDb } from './app-backend-sdk';
import { firestoreVersion, type RecordChange } from './realtimeQueryModel';

/** Tell open dashboards that a document changed.
 * The request is submitted in a different browser from the admin's, so a
 * local UI event cannot reveal it. This advances the same per-query revision
 * the open list is already watching. */
export async function publishCollectionRevision(table: string, id: string, before?: Record<string, unknown> | null): Promise<void> {
  const collection = String(table || '').trim();
  const recordId = String(id || '').trim();
  if (!collection || !recordId) return;
  try {
    const db = getFirestoreDb();
    if (!db) return;
    const snapshot = await db.collection(collection).doc(recordId).get();
    if (!snapshot.exists || !snapshot.updateTime) return;
    const { publishQueryChange } = await import('../../functions/src/publishQueryChange');
    const change: RecordChange = {
      table: collection,
      id: snapshot.id,
      version: firestoreVersion(snapshot.updateTime),
      before: before || undefined,
      after: snapshot.data() as Record<string, unknown>,
    };
    await publishQueryChange(db, change);
  } catch (error) {
    console.warn('[Realtime] Saved the record, but could not refresh open approval lists', error);
  }
}

export async function publishUsersRevision(id: string, before?: Record<string, unknown> | null): Promise<void> {
  return publishCollectionRevision('Users', id, before);
}
