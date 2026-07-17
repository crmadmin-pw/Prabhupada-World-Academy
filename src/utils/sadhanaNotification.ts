/**
 * Sadhana Notification Utility
 * Manages Web Push subscriptions and local reminder scheduling
 */

import { getVapidPublicKey, subscribePush, unsubscribePush } from 'zite-endpoints-sdk';

// ── Reminder times (IST) ──
const REMINDER_TIMES = {
  'night-1': { hour: 21, minute: 20 }, // 9:20 PM
  'night-2': { hour: 22, minute: 20 }, // 10:20 PM
  'morning': { hour: 7, minute: 40 },  // 7:40 AM next day
};

// ── localStorage helpers ──
const SUBMITTED_KEY = 'sadhana_submitted_today';
const SUBMITTED_DATE_KEY = 'sadhana_submitted_date';

export function hasSubmittedToday(): boolean {
  const date = localStorage.getItem(SUBMITTED_DATE_KEY);
  const today = new Date().toISOString().slice(0, 10);
  return date === today && localStorage.getItem(SUBMITTED_KEY) === 'true';
}

export function markSubmittedToday(): void {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(SUBMITTED_KEY, 'true');
  localStorage.setItem(SUBMITTED_DATE_KEY, today);
}

// ── Permission helpers ──
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const result = await Notification.requestPermission();
  if (result === 'granted') {
    await ensureSwRegistered();
  }
  return result;
}

// ── Service Worker registration ──
let _swRegistration: ServiceWorkerRegistration | null = null;

/** Returns true when SW registration is safe (secure context, not in iframe/editor preview) */
function canRegisterSw(): boolean {
  if (!('serviceWorker' in navigator)) return false;
  // Service workers require a secure context (HTTPS or localhost)
  if (!window.isSecureContext) return false;
  // Skip registration inside iframes (e.g. Zite editor preview)
  if (window.self !== window.top) return false;
  return true;
}

export async function ensureSwRegistered(): Promise<ServiceWorkerRegistration | null> {
  if (_swRegistration) return _swRegistration;
  if (!canRegisterSw()) return null;
  try {
    _swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return _swRegistration;
  } catch {
    // SW registration can fail in restricted contexts — non-critical, degrade gracefully
    return null;
  }
}

export async function registerServiceWorker(): Promise<void> {
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then(() => {
            console.log('[ServiceWorker] Unregistered local SW during development');
          });
        }
      });
    }
    return;
  }

  if (!canRegisterSw()) return;
  const reg = await ensureSwRegistered();
  if (!reg) return;

  // Listen for messages from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'GET_STATE') {
      navigator.serviceWorker.controller?.postMessage({
        type: 'SYNC_STATE',
        submittedToday: hasSubmittedToday(),
      });
    }
  });

  // Fire-and-forget: auto-resubscribe if permission is granted but no DB subscription
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    checkPushSubscriptionStatus().then(status => {
      if (!status) {
        subscribeToPush().catch(() => {});
      }
    });
  }
}

// ── Push subscription ──
let _subscribeLock: Promise<boolean> | null = null;

export async function subscribeToPush(): Promise<boolean> {
  if (_subscribeLock) return _subscribeLock;
  _subscribeLock = _doSubscribe();
  try {
    return await _subscribeLock;
  } finally {
    _subscribeLock = null;
  }
}

async function _doSubscribe(): Promise<boolean> {
  try {
    const reg = await ensureSwRegistered();
    if (!reg) return false;

    const { publicKey } = await getVapidPublicKey({});
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      // Already subscribed, re-send keys to DB
    } else {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });
    }

    const subJson = subscription.toJSON();
    const keys = subJson.keys || {};

    await subscribePush({
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh || '',
      auth: keys.auth || '',
    });

    return true;
  } catch (e) {
    console.error('[Push] Subscribe failed:', e);
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const reg = await ensureSwRegistered();
    if (!reg) return false;

    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await unsubscribePush({ endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    return true;
  } catch (e) {
    console.error('[Push] Unsubscribe failed:', e);
    return false;
  }
}

export async function checkPushSubscriptionStatus(): Promise<boolean> {
  try {
    const reg = await ensureSwRegistered();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// ── Local notification scheduling ──
let _reminderTimers: ReturnType<typeof setTimeout>[] = [];

export function scheduleSadhanaReminder(submittedToday: boolean): void {
  // Clear existing timers
  _reminderTimers.forEach(t => clearTimeout(t));
  _reminderTimers = [];

  // Notify the SW
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SUBMITTED_TODAY',
      submittedToday,
    });
  }

  if (submittedToday) return; // No reminders needed
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const now = new Date();
  // IST offset
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const istHour = istNow.getUTCHours();
  const istMinute = istNow.getUTCMinutes();

  for (const [slot, time] of Object.entries(REMINDER_TIMES)) {
    const targetIST = new Date(istNow);
    targetIST.setUTCHours(time.hour, time.minute, 0, 0);

    // Morning slot is for next day
    if (slot === 'morning' && (istHour < time.hour || (istHour === time.hour && istMinute < time.minute))) {
      // Morning is today — fine
    } else if (slot === 'morning') {
      targetIST.setUTCDate(targetIST.getUTCDate() + 1);
    }

    // Convert IST target to local time
    const targetLocal = new Date(targetIST.getTime() - istOffset);
    const delay = targetLocal.getTime() - now.getTime();

    if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
      const timer = setTimeout(() => {
        if (!hasSubmittedToday()) {
          showLocalNotification(slot as keyof typeof REMINDER_TIMES);
        }
      }, delay);
      _reminderTimers.push(timer);
    }
  }
}

function showLocalNotification(slot: string): void {
  const messages: Record<string, { title: string; body: string }> = {
    'night-1': { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana! Complete it before sleeping tonight.' },
    'night-2': { title: '🙏 Sadhana Reminder', body: "Don't forget — fill your Sadhana report before you sleep!" },
    'morning': { title: '⏰ Last Chance!', body: "Submit yesterday's Sadhana before the morning deadline!" },
  };

  const msg = messages[slot] || messages['night-1'];

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(msg.title, {
        body: msg.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `sadhana-${slot}`,
        data: { url: '/sadhana', slot },
      });
    });
  } else if (typeof Notification !== 'undefined') {
    new Notification(msg.title, { body: msg.body, tag: `sadhana-${slot}` });
  }
}

// ── Visibility change handler ──
export function initReminderVisibilityCheck(): void {
  const handler = () => {
    if (document.visibilityState === 'visible') {
      scheduleSadhanaReminder(hasSubmittedToday());
    }
  };
  document.addEventListener('visibilitychange', handler);
}

// ── Helpers ──
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
