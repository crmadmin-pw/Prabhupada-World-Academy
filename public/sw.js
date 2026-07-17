// Sadhana Tracker Service Worker — Push Notifications & Reminders
/* eslint-disable no-restricted-globals */

const APP_URL = '/sadhana';
const ICON_URL = '/icons/icon-192.png';

// ── State ──
let submittedToday = false;
const notifiedSlots = new Set();

// ── Reminder times (IST hours/minutes) ──
const REMINDER_TIMES = {
  'night-1': { hour: 21, minute: 20 },
  'night-2': { hour: 22, minute: 20 },
  'morning': { hour: 7, minute: 40 },
};

const SLOT_MESSAGES = {
  'night-1': { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana! Complete it before sleeping tonight.' },
  'night-2': { title: '🙏 Sadhana Reminder', body: "Don't forget — fill your Sadhana report before you sleep!" },
  'morning': { title: '⏰ Last Chance!', body: "Submit yesterday's Sadhana before the morning deadline!" },
};

// ── Push event (server-sent) ──
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Sadhana Reminder', body: event.data.text() };
  }

  const slot = data.slot || 'night-1';
  const msg = SLOT_MESSAGES[slot] || { title: data.title || 'Sadhana Reminder', body: data.body || '' };

  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: ICON_URL,
      badge: ICON_URL,
      tag: `sadhana-push-${slot}`,
      data: { url: data.url || APP_URL, slot },
      renotify: true,
    })
  );
});

// ── Notification click ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlPath = event.notification.data?.url || APP_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if found
      for (const client of windowClients) {
        if (client.url.includes(urlPath) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
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

  if (data.type === 'SYNC_STATE') {
    submittedToday = !!data.submittedToday;
    if (submittedToday) notifiedSlots.clear();
  }

  if (data.type === 'SUBMITTED_TODAY') {
    submittedToday = !!data.submittedToday;
    if (submittedToday) notifiedSlots.clear();
  }
});

// ── Periodic sync (background check) ──
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sadhana-reminder-check') {
    event.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  if (submittedToday) return;

  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const istHour = istNow.getUTCHours();
  const istMinute = istNow.getUTCMinutes();

  for (const [slot, time] of Object.entries(REMINDER_TIMES)) {
    if (notifiedSlots.has(slot)) continue;

    const targetMinutes = time.hour * 60 + time.minute;
    const currentMinutes = istHour * 60 + istMinute;

    // Fire if we're within 10 minutes past the target time
    if (currentMinutes >= targetMinutes && currentMinutes <= targetMinutes + 10) {
      const msg = SLOT_MESSAGES[slot];
      if (msg) {
        await self.registration.showNotification(msg.title, {
          body: msg.body,
          icon: ICON_URL,
          badge: ICON_URL,
          tag: `sadhana-local-${slot}`,
          data: { url: APP_URL, slot },
        });
        notifiedSlots.add(slot);
      }
    }
  }
}

// ── Install / Activate / Cache ──
const CACHE_NAME = 'sadhana-tracker-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/next.svg',
  '/window.svg',
  '/file.svg',
  '/globe.svg',
  '/vercel.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip API queries, hot-reloading hooks, and browser extension assets
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    !url.protocol.startsWith('http')
  ) {
    return;
  }

  // Stale-While-Revalidate Strategy for static assets and local pages
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
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
