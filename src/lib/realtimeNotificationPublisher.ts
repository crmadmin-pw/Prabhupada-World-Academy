import { REALTIME_IDENTITIES } from './realtimeCollections';
import { getNotificationDepartment } from './notificationDepartment';

const DELIVERY_WINDOW_MS = 5 * 60_000;
const REALTIME_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Route a server-authorized notification directly to each matching signed-in
 * browser inbox. The Firestore trigger also calls this function when deployed;
 * using deterministic document IDs makes both paths safely idempotent.
 */
export async function publishNotification(db: any, broadcast: Record<string, any>) {
  if (!broadcast.id || !broadcast.title || Number(broadcast.sentAt) < Date.now() - DELIVERY_WINDOW_MS) return 0;

  const targeted = Array.isArray(broadcast.inviteeIds) || Array.isArray(broadcast.inviteeEmails);
  const recipients = [...new Set<string>([
    ...(broadcast.inviteeIds || []).map((value: unknown) => String(value).trim()).filter(Boolean),
    ...(broadcast.inviteeEmails || []).map((value: unknown) => String(value).trim().toLowerCase()).filter(Boolean),
  ])];
  const identities = new Map<string, any>();

  if (targeted) {
    for (let offset = 0; offset < recipients.length; offset += 30) {
      const aliases = recipients.slice(offset, offset + 30);
      if (!aliases.length) continue;
      const snapshot = await db.collection(REALTIME_IDENTITIES)
        .where('aliases', 'array-contains-any', aliases).get();
      snapshot.docs.forEach((doc: any) => identities.set(doc.id, doc));
    }
  } else {
    // A global broadcast is an explicit server-authorized workflow. Registered
    // identities need no native-notification permission for foreground alerts.
    const snapshot = await db.collection(REALTIME_IDENTITIES).get();
    snapshot.docs.forEach((doc: any) => identities.set(doc.id, doc));
  }

  const message = {
    id: broadcast.id,
    title: broadcast.title,
    body: broadcast.body || '',
    slot: broadcast.slot || 'broadcast',
    sentAt: broadcast.sentAt,
    url: broadcast.url || '/sadhana',
    realtimeExpiresAt: new Date(Number(broadcast.sentAt) + REALTIME_RETENTION_MS),
  };
  const senderEmail = String(broadcast.senderEmail || '').trim().toLowerCase();
  const segment = String(broadcast.segment || '').trim().toUpperCase();
  const list = [...identities.values()];
  let delivered = 0;

  for (let offset = 0; offset < list.length; offset += 20) {
    const results = await Promise.all(list.slice(offset, offset + 20).map(async identity => {
      const userDocumentId = String(identity.data()?.userDocumentId || '').trim();
      if (!userDocumentId) return false;
      const profile = await db.collection('Users').doc(userDocumentId).get();
      if (!profile.exists) return false;
      const profileData = profile.data() || {};
      const email = String(profileData.email || '').trim().toLowerCase();
      if (senderEmail && email === senderEmail) return false;
      // Re-evaluate current department, including migrated legacy FOLK flags.
      if (segment && getNotificationDepartment(profileData) !== segment) return false;
      await db.collection('RealtimeClients').doc(identity.id)
        .collection('notifications').doc(broadcast.id).set(message);
      return true;
    }));
    delivered += results.filter(Boolean).length;
  }
  return delivered;
}
