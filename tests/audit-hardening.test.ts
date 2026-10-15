import assert from 'node:assert/strict';
import test from 'node:test';
import { setFirestoreForTests, Users } from '../src/lib/app-backend-sdk';
import { matchesAnySecret } from '../src/lib/secretMatch';
import { imageBytesMatchType } from '../src/lib/uploadPolicy';
import { findByPhone, phoneMatchKey } from '../src/lib/phoneLookup';
import {
  clearOfflineQueue,
  enqueueOfflinePayload,
  flushOfflineQueue,
  setOfflineQueueStorageForTests,
} from '../src/lib/offlineQueue';

test('secrets match without leaking the length', () => {
  assert.equal(matchesAnySecret('correct-secret', ['other', 'correct-secret']), true);
  assert.equal(matchesAnySecret('correct-secret', ['correct-secre']), false);
  assert.equal(matchesAnySecret('correct-secret', ['', undefined]), false);
  assert.equal(matchesAnySecret('', ['correct-secret']), false);
});

test('image uploads require the declared file signature', () => {
  assert.equal(imageBytesMatchType('image/jpeg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)), true);
  assert.equal(imageBytesMatchType('image/png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47)), true);
  assert.equal(imageBytesMatchType('image/gif', Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), true);
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(imageBytesMatchType('image/webp', webp), true);
  assert.equal(imageBytesMatchType('image/jpeg', Uint8Array.of(0x3c, 0x68, 0x74, 0x6d, 0x6c)), false);
  assert.equal(imageBytesMatchType('text/html', Uint8Array.of(0xff, 0xd8, 0xff)), false);
});

test('phone lookup treats country-code spellings as one number', async () => {
  assert.equal(phoneMatchKey('+91 98765 43210'), phoneMatchKey('9876543210'));
  const found = await findByPhone({
    async findAll() {
      return { records: [
        { id: 'match', phone: '+91 98765 43210' },
        { id: 'other', phone: '1111111111' },
      ] };
    },
  }, '9876543210');
  assert.deepEqual(found.map(record => record.id), ['match']);
});

test('list filters longer than one Firestore query are fetched in full', async () => {
  const sizes: number[] = [];
  setFirestoreForTests({
    collection() {
      const clauses: { op: string; value: unknown }[] = [];
      const query = {
        where(_field: unknown, op: string, value: unknown) {
          clauses.push({ op, value });
          return query;
        },
        orderBy() { return query; },
        select() { return query; },
        limit() { return query; },
        offset() { return query; },
        async get() {
          const ids = clauses.filter(clause => clause.op === 'in').flatMap(clause => clause.value as string[]);
          sizes.push(ids.length);
          return {
            readTime: { seconds: 1, nanoseconds: 0 },
            docs: ids.map(id => ({ id, data: () => ({ name: id }) })),
          };
        },
      };
      return query;
    },
  });
  try {
    const ids = Array.from({ length: 45 }, (_, index) => `user-${index}`);
    const { records } = await Users.findAll({ filters: { id: { in: ids } }, limit: 100 });
    assert.deepEqual(sizes.slice().sort((a, b) => a - b), [15, 30]);
    assert.equal(records.length, 45);

    await assert.rejects(
      () => Users.findAll({ filters: { fullName: { contains: 'a' } } }),
      /Unsupported filter operator "contains"/,
    );
  } finally {
    setFirestoreForTests(undefined);
  }
});

test('a queued record is replayed only for the login that saved it', async () => {
  const values = new Map<string, string>();
  setOfflineQueueStorageForTests({
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  });
  clearOfflineQueue();
  values.set('auth_user_id', 'user-a');
  enqueueOfflinePayload('sadhana_entry', { entryDate: '2026-10-05' }, { dedupeKey: 'sadhana:a', silent: true });

  values.set('auth_user_id', 'user-b');
  const sent: string[] = [];
  await flushOfflineQueue(async item => { sent.push(item.ownerUid || ''); });
  assert.equal(sent.length, 0);

  values.set('auth_user_id', 'user-a');
  await flushOfflineQueue(async item => { sent.push(item.ownerUid || ''); });
  assert.deepEqual(sent, ['user-a']);
  setOfflineQueueStorageForTests(null);
});
