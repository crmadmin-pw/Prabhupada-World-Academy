import { getFirestoreDb } from './app-backend-sdk';
import { firestoreVersion, type RecordChange } from './realtimeQueryModel';

/** Tell open dashboards that a Users document changed.
 * Registration runs in a different browser from the admin's, so a local UI
 * event cannot reveal the new request. This advances the same per-query
 * revision the approvals list is already watching. */
export async function publishUsersRevision(id: string, before?: Record<string, unknown> | null): Promise<void> {
  const userId = String(id || '').trim();
  if (!userId) return;
  try {
    const db = getFirestoreDb();
    if (!db) return;
    const snapshot = await db.collection('Users').doc(userId).get();
    if (!snapshot.exists || !snapshot.updateTime) return;
    const { publishQueryChange } = await import('../../functions/src/publishQueryChange');
    const change: RecordChange = {
      table: 'Users',
      id: snapshot.id,
      version: firestoreVersion(snapshot.updateTime),
      before: before || undefined,
      after: snapshot.data() as Record<string, unknown>,
    };
    await publishQueryChange(db, change);
  } catch (error) {
    console.warn('[Realtime] Saved the user, but could not refresh open approval lists', error);
  }
}
