'use client';

import { useEffect, useLayoutEffect } from 'react';
import { dashboardScope } from '@/lib/dashboardScope';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { receiveEndpointRevision, setEndpointPermissionScope, subscribeEndpointCache, getEndpointRealtimeTokens, forgetEndpointRevisionToken } from '@/lib/app-endpoints-sdk';
import { getRealtimeFirestore } from '@/lib/realtimeFirestore';
import { realtimeListenerBatches } from '@/lib/realtimeListenerBatches';
import { invalidateCache } from '@/utils/cache';
import { triggerInAppOrNativeNotification } from '@/utils/sadhanaNotification';
import { toast } from 'sonner';

export default function RealtimeSyncProvider() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const permissionScope = dashboardScope(profile, user?.id || user?.email);
  useLayoutEffect(() => {
    // Authority changes are the only reason to discard all of this user's
    // cached data. Routine realtime updates preserve every unaffected query.
    setEndpointPermissionScope(permissionScope);
    invalidateCache();
  }, [permissionScope]);

  useEffect(() => {
    if (!user?.id) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeNotifications: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const uid = user.id;
    const statusToast = 'realtime-connection-status';
    const offline = () => toast.warning('Offline — showing saved data. Updates will sync when you reconnect.', { id: statusToast, duration: Infinity });
    if (!navigator.onLine) offline();

    const connect = async () => {
      try {
        const { firestore, db } = await getRealtimeFirestore();
        if (disposed) return;
        unsubscribe?.();
        unsubscribeNotifications?.();
        const streams = new Map<string, () => void>();
        const healthyStreams = new Set<string>();
        let notificationsHealthy = false;
        const checkHealthy = () => {
          if (notificationsHealthy && [...streams.keys()].every(key => healthyStreams.has(key))) {
            attempts = 0;
            toast.dismiss(statusToast);
          }
        };
        let batch: ReturnType<typeof setTimeout> | undefined;
        const syncStreams = () => {
          const chunks = realtimeListenerBatches(getEndpointRealtimeTokens(), streams.keys());
          for (const [key, stop] of streams) if (!chunks.has(key)) { stop(); streams.delete(key); healthyStreams.delete(key); }
          for (const [key, part] of chunks) {
            if (streams.has(key)) continue;
            streams.set(key, firestore.onSnapshot(
              firestore.query(firestore.collection(db, 'RealtimeClients', uid, 'queries'), firestore.where(firestore.documentId(), 'in', part)),
              { includeMetadataChanges: true }, snapshot => {
                if (!snapshot.metadata.fromCache) { healthyStreams.add(key); checkHealthy(); }
                for (const change of snapshot.docChanges()) {
                  if (change.type === 'removed') forgetEndpointRevisionToken(change.doc.id);
                  else receiveEndpointRevision(change.doc.id, String(change.doc.data().version || ''));
                }
                // TTL may have removed an abandoned query while offline.
                // A server snapshot, not a cache-only snapshot, proves absence.
                if (!snapshot.metadata.fromCache) for (const token of part) {
                  if (!snapshot.docs.some(item => item.id === token)) forgetEndpointRevisionToken(token);
                }
              }, error => { healthyStreams.delete(key); retry(error); },
            ));
          }
        };
        const stopCache = subscribeEndpointCache(() => {
          if (batch) return;
          batch = setTimeout(() => { batch = undefined; if (!disposed) syncStreams(); }, 120);
        });
        syncStreams();
        unsubscribe = () => { stopCache(); clearTimeout(batch); streams.forEach(stop => stop()); streams.clear(); };
        unsubscribeNotifications = firestore.onSnapshot(
          firestore.query(
            firestore.collection(db, 'RealtimeClients', uid, 'notifications'),
            firestore.where('sentAt', '>', Date.now() - 5 * 60_000),
            firestore.orderBy('sentAt', 'desc'), firestore.limit(50),
          ),
          snapshot => {
            if (!snapshot.metadata.fromCache) { notificationsHealthy = true; checkHealthy(); }
            for (const change of snapshot.docChanges()) {
              // Notification inbox documents are immutable messages. Only an
              // added document is a delivery event; a modified snapshot must
              // never replay a toast.
              if (change.type !== 'added') continue;
              const message = change.doc.data();
              if (Number(message.sentAt) < Date.now() - 5 * 60_000) continue;
              triggerInAppOrNativeNotification({ ...message, id: change.doc.id,
                // Native Web Push owns background/closed-browser delivery.
                suppressNative: document.visibilityState !== 'visible',
              });
            }
          }, error => { notificationsHealthy = false; retry(error); },
        );
      } catch (error) { retry(error); }
    };
    function retry(error: unknown) {
      if (disposed) return;
      console.warn('[Realtime] Listener disconnected; existing data is retained.', (error as { code?: string })?.code || 'unavailable');
      toast.warning('Live updates are temporarily unavailable. Existing data is retained while reconnection is attempted.', { id: statusToast, duration: Infinity });
      // Failed-listener backoff, never a periodic API freshness check.
      if (retryTimer) return;
      if (attempts++ < 5) retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, Math.min(30_000, 1000 * 2 ** (attempts - 1)));
    }
    const resume = () => {
      if (!disposed && attempts > 0 && document.visibilityState !== 'hidden') {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        attempts = 0;
        void connect();
      }
    };
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', resume);
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      unsubscribe?.();
      unsubscribeNotifications?.();
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      toast.dismiss(statusToast);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [user?.id, permissionScope]);
  return null;
}
