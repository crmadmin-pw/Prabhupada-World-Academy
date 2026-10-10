import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearOfflineQueue,
  enqueueOfflinePayload,
  flushOfflineQueue,
  getOfflineQueue,
  installOfflineSync,
  sendOrQueue,
  setOfflineQueueStorageForTests,
} from '../src/lib/offlineQueue';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('offline submissions are sent on flush and removed only after success', async () => {
  setOfflineQueueStorageForTests(memoryStorage());
  clearOfflineQueue();
  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-01', rounds: 16 }, { dedupeKey: 'sadhana:user:2026-10-01', silent: true });
  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-01', rounds: 20 }, { dedupeKey: 'sadhana:user:2026-10-01', silent: true });
  enqueueOfflinePayload('bv_registration', { fullName: 'Devotee' }, { dedupeKey: 'bv:user', silent: true });

  assert.equal(getOfflineQueue().length, 2);
  assert.equal(getOfflineQueue()[0].payload.rounds, 20);

  const sent: string[] = [];
  const result = await flushOfflineQueue(async item => {
    sent.push(`${item.type}:${item.payload.rounds ?? item.payload.fullName}`);
  });

  assert.deepEqual(sent, ['sadhana_entry:20', 'bv_registration:Devotee']);
  assert.equal(result.synced, 2);
  assert.equal(getOfflineQueue().length, 0);
  setOfflineQueueStorageForTests(null);
});

test('network and auth failures stay queued; rejected records do not', async () => {
  setOfflineQueueStorageForTests(memoryStorage());
  clearOfflineQueue();
  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-02' }, { dedupeKey: 'keep', silent: true });
  enqueueOfflinePayload('role_update', { endpoint: 'assignBvRole', input: { userId: 'u', role: 'ADMIN' } }, { dedupeKey: 'drop', silent: true });

  await flushOfflineQueue(async item => {
    if (item.dedupeKey === 'keep') throw Object.assign(new Error('unavailable'), { status: 503 });
    throw Object.assign(new Error('Role is not allowed'), { status: 400 });
  });

  const remaining = getOfflineQueue();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].dedupeKey, 'keep');
  assert.equal(remaining[0].attempts, 1);
  assert.ok((remaining[0].retryAfter || 0) > Date.now());

  let retried = false;
  await flushOfflineQueue(async () => { retried = true; });
  assert.equal(retried, false);
  assert.equal(getOfflineQueue().length, 1);

  clearOfflineQueue();
  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-03' }, { dedupeKey: 'auth', silent: true });
  await flushOfflineQueue(async () => {
    throw Object.assign(new Error('User is not authenticated'), { status: 401 });
  });
  assert.equal(getOfflineQueue().length, 1);
  setOfflineQueueStorageForTests(null);
});

test('sendOrQueue stores the payload while offline and a later flush delivers it', async () => {
  setOfflineQueueStorageForTests(memoryStorage());
  clearOfflineQueue();
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

  let sendCalls = 0;
  const outcome = await sendOrQueue({
    type: 'sadhana_entry',
    dedupeKey: 'sadhana:user:2026-10-05',
    payload: { userId: 'user', entryDate: '2026-10-05', totalScore: 12 },
    send: async () => { sendCalls++; return { entryId: 'should-not-run' }; },
  });

  assert.equal(outcome.status, 'queued');
  assert.equal(sendCalls, 0);
  assert.equal(getOfflineQueue()[0].payload.totalScore, 12);

  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  const delivered: any[] = [];
  await flushOfflineQueue(async item => { delivered.push(item.payload); });
  assert.deepEqual(delivered, [{ userId: 'user', entryDate: '2026-10-05', totalScore: 12 }]);
  assert.equal(getOfflineQueue().length, 0);

  const sent = await sendOrQueue({
    type: 'sadhana_entry',
    dedupeKey: 'sadhana:user:2026-10-05',
    payload: { userId: 'user', entryDate: '2026-10-05', totalScore: 16 },
    send: async () => ({ entryId: 'E-1' }),
  });
  assert.equal(sent.status, 'sent');
  if (sent.status === 'sent') assert.equal(sent.result.entryId, 'E-1');
  assert.equal(getOfflineQueue().length, 0);

  await assert.rejects(
    sendOrQueue({
      type: 'bv_registration',
      dedupeKey: 'bv:user',
      payload: { fullName: 'Devotee' },
      send: async () => { throw Object.assign(new Error('Invalid date of birth'), { status: 400 }); },
    }),
    /Invalid date of birth/,
  );
  assert.equal(getOfflineQueue().length, 0);

  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: previousNavigator, configurable: true });
  setOfflineQueueStorageForTests(null);
});

test('the online event replays pending records instead of only announcing a sync', async () => {
  setOfflineQueueStorageForTests(memoryStorage());
  clearOfflineQueue();
  const listeners = new Map<string, EventListener>();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      addEventListener() {},
      removeEventListener() {},
      visibilityState: 'visible',
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

  enqueueOfflinePayload('role_update', {
    endpoint: 'assignBvRole',
    input: { userId: 'user-1', role: 'FACILITATOR' },
  }, { dedupeKey: 'role:user-1', silent: true });

  const delivered: string[] = [];
  const stop = installOfflineSync(async item => { delivered.push(item.type); });
  await flushOfflineQueue();
  assert.deepEqual(delivered, ['role_update']);
  assert.equal(getOfflineQueue().length, 0);

  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-04' }, { dedupeKey: 'sadhana:later', silent: true });
  listeners.get('online')?.(new Event('online'));
  await flushOfflineQueue();
  assert.deepEqual(delivered, ['role_update', 'sadhana_entry']);
  assert.equal(getOfflineQueue().length, 0);

  stop();
  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true });
  if (previousDocument === undefined) delete (globalThis as { document?: unknown }).document;
  else Object.defineProperty(globalThis, 'document', { value: previousDocument, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: previousNavigator, configurable: true });
  setOfflineQueueStorageForTests(null);
});
