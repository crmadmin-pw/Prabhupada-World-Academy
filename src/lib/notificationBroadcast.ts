/**
 * Notification broadcast store.
 *
 * Primary store: server-only Firestore collection `NotificationBroadcasts`.
 * Each dispatch has its own document so simultaneous messages cannot overwrite
 * each other. The latest legacy document remains available during rollouts.
 *
 * Fallback: in-process memory + /tmp file
 * — used when Firestore is unavailable (local dev, cold starts).
 */

import fs from 'fs';
import path from 'path';
import { getFirestoreDb } from './app-backend-sdk';
import { publishNotification, type NotificationDeliveryResult } from './realtimeNotificationPublisher';

export interface BroadcastData {
  id: string;
  title: string;
  body: string;
  slot: string;
  sentAt: number;
  senderEmail?: string;
  inviteeIds?: string[];
  inviteeEmails?: string[];
  url?: string;
  segment?: string;
}

// In-process memory cache so the long-poll tight loop doesn't hammer Firestore
let _memCache: BroadcastData[] = [];
let _memCacheTime = 0;
const MEM_CACHE_TTL_MS = 500; // refresh from Firestore at most every 500ms
const DELIVERY_WINDOW_MS = 5 * 60_000;

let _idCounter = 0;
const BROADCAST_FILE = path.join('/tmp', 'pw-latest-broadcast.json');

// This module is imported only by server endpoints. A static binding is
// required so Next/App Hosting includes the database SDK in the server bundle;
// a runtime require can be omitted during bundling and silently return null.
function getDb(): any | null {
  try {
    return getFirestoreDb?.() ?? null;
  } catch {
    return null;
  }
}

const FIRESTORE_DOC = { collection: 'meta', doc: 'latestBroadcast' };

export async function storeBroadcast(
  title: string,
  body: string,
  slot: string,
  senderEmail?: string,
  id?: string,
  inviteeIds?: string[],
  url?: string,
  inviteeEmails?: string[],
  segment?: string,
): Promise<NotificationDeliveryResult> {
  const broadcast: BroadcastData = {
    id: id || (String(Date.now()) + '_' + String(++_idCounter)),
    title,
    body,
    slot,
    sentAt: Date.now(),
    senderEmail,
    inviteeIds,
    inviteeEmails,
    url,
    segment,
  };

  // Await shared persistence before the request ends. App Hosting can stop
  // background work once a response is sent.
  const db = getDb();
  let inAppDelivery: NotificationDeliveryResult = { count: 0, userIds: [] };
  if (db) {
    const batch = db.batch();
    // Remove optional undefined properties for Firestore configurations that
    // do not enable ignoreUndefinedProperties.
    const record = JSON.parse(JSON.stringify(broadcast));
    batch.set(db.collection('NotificationBroadcasts').doc(broadcast.id), record);
    batch.set(db.collection(FIRESTORE_DOC.collection).doc(FIRESTORE_DOC.doc), record);
    await batch.commit();
    // Route immediately from the App Hosting request. This keeps in-app
    // meeting reminders working even when the optional Firestore-trigger
    // worker has not been provisioned. The deterministic notification ID
    // makes a later trigger delivery idempotent.
    inAppDelivery = await publishNotification(db, record);
  }
  _memCache = [..._memCache.filter(item => item.id !== broadcast.id && item.sentAt > Date.now() - DELIVERY_WINDOW_MS), broadcast];
  _memCacheTime = 0; // reread other instances' concurrent dispatches

  // Also write /tmp as local fallback
  try {
    fs.writeFileSync(BROADCAST_FILE, JSON.stringify({ ...broadcast, recent: _memCache }), 'utf8');
  } catch {
    // Non-critical — Firestore is the primary store
  }
  return inAppDelivery;
}

export async function getRecentBroadcasts(): Promise<BroadcastData[]> {
  // Return in-process cache if fresh enough (avoids Firestore reads on every poll tick)
  if ((Date.now() - _memCacheTime) < MEM_CACHE_TTL_MS) {
    return _memCache;
  }

  // Try Firestore first (shared across all instances)
  const db = getDb();
  if (db) {
    try {
      const snap = await db.collection('NotificationBroadcasts')
        .where('sentAt', '>', Date.now() - DELIVERY_WINDOW_MS)
        .orderBy('sentAt', 'desc').limit(100).get();
      _memCache = snap.docs.map((doc: any) => doc.data() as BroadcastData)
        .sort((a: BroadcastData, b: BroadcastData) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
      _memCacheTime = Date.now();
      return _memCache;
    } catch (e) {
      console.warn('[Notifications] Firestore read failed, falling back to /tmp:', e);
    }
  }

  // Fallback: /tmp file (single-instance or local dev)
  try {
    if (!fs.existsSync(BROADCAST_FILE)) return _memCache;
    const raw = fs.readFileSync(BROADCAST_FILE, 'utf8');
    const data = JSON.parse(raw) as BroadcastData & { recent?: BroadcastData[] };
    _memCache = (data.recent || [data]).filter(item => item.sentAt > Date.now() - DELIVERY_WINDOW_MS)
      .sort((a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id));
    _memCacheTime = Date.now();
    return _memCache;
  } catch {
    return _memCache;
  }
}

export function broadcastsAfter(broadcasts: BroadcastData[], lastId: string): BroadcastData[] {
  if (lastId.startsWith('cursor-')) {
    const startedAt = Number(lastId.slice('cursor-'.length));
    return broadcasts.filter(item => item.sentAt >= startedAt);
  }
  const index = broadcasts.findIndex(item => item.id === lastId);
  return broadcasts.slice(index + 1);
}
