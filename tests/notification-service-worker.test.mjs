import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function worker(windows = []) {
  const listeners = {};
  const native = [];
  const messages = [];
  const clients = {
    matchAll: async () => windows.map(window => ({...window, postMessage: data => messages.push(data)})),
  };
  const self = {
    clients, location: {origin: 'https://example.invalid'},
    registration: {showNotification: async (title, options) => native.push({title, ...options})},
    addEventListener: (type, handler) => { listeners[type] = handler; },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {self, clients, console, URL});
  const send = async (data) => {
    const work = [];
    listeners.push({data: {json: () => data}, waitUntil: promise => work.push(promise)});
    await Promise.all(work);
  };
  return {send, native, messages, listeners};
}

test('only a focused app suppresses native delivery; unfocused, hidden, and closed apps receive it', async () => {
  const cases = [
    { state: 'focused', windows: [{visibilityState: 'visible', focused: true}], native: 0 },
    // Chrome can retain a stale `visible` state for a minimized/suspended PWA.
    { state: 'unfocused', windows: [{visibilityState: 'visible', focused: false}], native: 1 },
    { state: 'hidden', windows: [{visibilityState: 'hidden', focused: false}], native: 1 },
    { state: 'closed', windows: [], native: 1 },
  ];
  for (const item of cases) {
    const app = worker(item.windows);
    await app.send({id: 'folk-reminder', title: 'FOLK reminder', body: 'Submit Sadhana', url: '/sadhana'});
    assert.equal(app.native.length, item.native, item.state);
    assert.equal(app.messages.length, item.state === 'closed' ? 0 : 1);
    if (app.native.length) assert.equal(app.native[0].data.url, '/sadhana');
    await app.send({id: 'folk-reminder', title: 'FOLK reminder'});
    assert.equal(app.native.length, item.native, 'the same push is not shown twice');
  }
});

test('disabling automatic reminders does not suppress an instant admin notification', async () => {
  const app = worker();
  app.listeners.message({data: {type: 'SYNC_SETTINGS', adminDisabled: true}});
  await app.send({id: 'instant', title: 'Instant reminder'});
  assert.equal(app.native.length, 1);
  assert.equal(app.listeners.periodicsync, undefined, 'background timers cannot fabricate reminders');
});
