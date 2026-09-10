// Sadhana Tracker Service Worker — Push Notifications & Reminders
/* eslint-disable no-restricted-globals */

const APP_URL = '/sadhana';
const ICON_URL = '/icons/icon-192.png';
const BADGE_URL = '/icons/icon-192.png';

// ── Top-level state declarations ──
let swUserNotificationsDisabled = false;
// Track processed broadcast IDs to avoid duplicate Web Push deliveries.
const processedBroadcastIds = new Set();

function notificationTag(slot, id) {
  return 'sadhana-' + (slot || 'reminder') + '-' + (id || Date.now());
}

// ── Slot messages (fallback text) ──
const SLOT_MESSAGES = {
  'night-1': { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana! Complete it before sleeping tonight.' },
  'night-2': { title: '🙏 Sadhana Reminder', body: "Don't forget — fill your Sadhana report before you sleep!" },
  'morning': { title: '⏰ Last Chance!', body: "Submit yesterday's Sadhana before the morning deadline!" },
};

// Foreground delivery uses the authenticated Firestore inbox. Background and
// closed-browser delivery uses native Web Push; no service-worker API polling.

// ── Push event (server-sent Web Push delivery) ──
self.addEventListener('push', (event) => {
  let data = null;
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    try {
      data = { title: '📿 Sadhana Reminder', body: event.data.text() };
    } catch {
      data = { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana report!' };
    }
  }

  if (!data) {
    data = { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana report!' };
  }

  // User-level bypass guard
  if (swUserNotificationsDisabled) {
    console.log('[SW] Skipping push event: user has disabled notifications');
    return;
  }

  // Deduplication check
  if (data.id) {
    if (processedBroadcastIds.has(data.id)) return;
    processedBroadcastIds.add(data.id);
    if (processedBroadcastIds.size > 100) {
      const first = processedBroadcastIds.values().next().value;
      if (first !== undefined) processedBroadcastIds.delete(first);
    }
  }

  const slot = data.slot || 'night-1';
  // Prioritize title and body sent by server (which may contain custom super admin content)
  const titleToUse = data.title || (SLOT_MESSAGES[slot] ? SLOT_MESSAGES[slot].title : '📿 Sadhana Reminder');
  const bodyToUse = data.body || (SLOT_MESSAGES[slot] ? SLOT_MESSAGES[slot].body : 'Time to fill your Sadhana report before sleeping tonight.');
  const urlToUse = data.url || APP_URL;

  // Broadcast to active pages and conditionally show native notification
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        let hasFocusedClient = false;
        for (const client of windowClients) {
          // A minimized/suspended Chrome or installed-PWA window can remain
          // `visible` even though it is not in the foreground. Only a focused
          // window may replace the native notification with an in-app toast.
          if (client.focused === true) {
            hasFocusedClient = true;
          }
          try {
            client.postMessage({
              type: 'PUSH_RECEIVED',
              id: data.id || '',
              title: titleToUse,
              body: bodyToUse,
              slot,
              senderEmail: data.senderEmail || '',
              url: urlToUse,
              inviteeIds: data.inviteeIds || [],
            });
          } catch (e) {
            console.warn('[SW] Failed to postMessage to window client:', e);
          }
        }

        // Focused pages render the in-app reminder. Backgrounded or closed
        // pages receive the browser's native notification.
        if (!hasFocusedClient) {
          return self.registration.showNotification(titleToUse, {
            body: bodyToUse,
            icon: ICON_URL,
            badge: BADGE_URL,
            tag: notificationTag(slot, data.id),
            data: { url: urlToUse, slot, inviteeIds: data.inviteeIds || [] },
            renotify: false,
            requireInteraction: true,
            silent: false,
            timestamp: Date.now(),
          });
        }
      })
      .catch((err) => {
        console.error('[SW] Push handler error, falling back to showNotification:', err);
        return self.registration.showNotification(titleToUse, {
          body: bodyToUse,
          icon: ICON_URL,
          badge: BADGE_URL,
          tag: notificationTag(slot, data.id),
          data: { url: urlToUse, slot },
          renotify: false,
          silent: false,
          timestamp: Date.now(),
        });
      })
  );
});

// ── Notification click ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlPath = event.notification.data?.url || APP_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        try {
          const clientUrl = new URL(client.url);
          const targetUrl = new URL(urlPath, self.location.origin);
          if (clientUrl.origin === targetUrl.origin) {
            if ('navigate' in client) {
              client.navigate(urlPath);
            }
            if ('focus' in client) {
              return client.focus();
            }
          }
        } catch {
          if (client.url.includes(urlPath) && 'focus' in client) {
            return client.focus();
          }
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlPath);
      }
    })
  );
});

// ── Message listener ──
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SYNC_SETTINGS') {
    if (data.userDisabled !== undefined) {
      swUserNotificationsDisabled = !!data.userDisabled;
    } else if (data.disabled !== undefined) {
      swUserNotificationsDisabled = !!data.disabled;
    }
  }
});

// Scheduled reminders arrive from the server through Web Push. No local
// periodic timer: it cannot reliably check saved days or submitted Sadhana.

// ── Cache Configuration ──
const CACHE_NAME = 'sadhana-static-cache-v3';
const ASSETS_TO_CACHE = [
  '/manifest.json',
  '/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/next.svg',
  '/globe.svg',
  '/window.svg',
  '/file.svg',
  '/vercel.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching static assets');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[ServiceWorker] Pre-caching failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing obsolete cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/api/') || 
    url.pathname.includes('webpack') || 
    url.pathname.includes('hot-update') ||
    url.pathname.includes('/_next/')
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          return cachedResponse;
        });

        return cachedResponse || fetchPromise;
      });
    })
  );
});
