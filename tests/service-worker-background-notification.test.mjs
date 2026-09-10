import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadServiceWorker() {
  const listeners = new Map();
  const notifications = [];
  let windowClients = [];

  const clients = {
    matchAll: async () => windowClients,
    claim: async () => {},
    openWindow: async () => {},
  };
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients,
    location: { origin: 'https://academy.prabhupadaworld.com' },
    registration: {
      showNotification: async (title, options) => notifications.push({ title, options }),
      pushManager: { getSubscription: async () => ({}) },
    },
    skipWaiting: async () => {},
  };

  const context = vm.createContext({
    self,
    clients,
    caches: {
      open: async () => ({ addAll: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    console,
    Date,
    URL,
    fetch: async () => ({ ok: false }),
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), context);

  return {
    notifications,
    setClients(nextClients) {
      windowClients = nextClients;
    },
    async push(data) {
      let completion;
      listeners.get('push')({
        data: { json: () => data, text: () => JSON.stringify(data) },
        waitUntil(promise) {
          completion = promise;
        },
      });
      await completion;
    },
  };
}

test('backgrounded app receives a native browser notification', async () => {
  const worker = loadServiceWorker();
  const messages = [];
  worker.setClients([{
    focused: false,
    visibilityState: 'hidden',
    postMessage: message => messages.push(message),
  }]);

  await worker.push({ id: 'background-reminder', title: 'Meeting soon', body: 'Join now', url: 'https://meet.google.com/example' });

  assert.equal(messages.length, 1);
  assert.equal(worker.notifications.length, 1);
  assert.equal(worker.notifications[0].title, 'Meeting soon');
});

test('visible app receives the in-app message without a duplicate native notification', async () => {
  const worker = loadServiceWorker();
  const messages = [];
  worker.setClients([{
    focused: true,
    visibilityState: 'visible',
    postMessage: message => messages.push(message),
  }]);

  await worker.push({ id: 'foreground-reminder', title: 'Meeting soon', body: 'Join now' });

  assert.equal(messages.length, 1);
  assert.equal(worker.notifications.length, 0);
});

test('an unfocused client receives native delivery even if Chrome reports it as visible', async () => {
  const worker = loadServiceWorker();
  worker.setClients([{
    focused: false,
    visibilityState: 'visible',
    postMessage: () => {},
  }]);

  await worker.push({ id: 'suspended-pwa-reminder', title: 'Meeting soon', body: 'Join now' });

  assert.equal(worker.notifications.length, 1);
});
