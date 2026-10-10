import assert from 'node:assert/strict';
import test from 'node:test';
import { setFirestoreForTests, SkillCatalog } from '../src/lib/app-backend-sdk';

const indexError = Object.assign(
  new Error('9 FAILED_PRECONDITION: The query requires an index.'),
  { code: 9 },
);
const deleteError = new Error('UNAVAILABLE: Firestore is unavailable');

const state: { read: 'index' | 'empty' | 'found'; deleteFails: boolean } = {
  read: 'index',
  deleteFails: true,
};

function collection() {
  const query = {
    where() { return query; },
    orderBy() { return query; },
    select() { return query; },
    limit() { return query; },
    offset() { return query; },
    async get() {
      if (state.read === 'index') throw indexError;
      const readTime = { seconds: 1, nanoseconds: 0 };
      if (state.read === 'found') {
        return { empty: false, docs: [{ id: 'rec-1', data: () => ({ name: 'kept' }) }], readTime };
      }
      return { empty: true, docs: [], readTime };
    },
    doc() {
      const readTime = { seconds: 1, nanoseconds: 0 };
      return {
        async get() {
          if (state.read === 'index') throw indexError;
          if (state.read === 'found') return { exists: true, id: 'rec-1', data: () => ({ name: 'kept' }), readTime };
          return { exists: false, id: 'missing', data: () => undefined, readTime };
        },
        async delete() {
          if (state.deleteFails) throw deleteError;
        },
        async set() {},
      };
    },
  };
  return query;
}

test.before(() => setFirestoreForTests({ collection }));
test.after(() => setFirestoreForTests(undefined));

test('a missing index is a database error, not an empty result', async () => {
  state.read = 'index';
  await assert.rejects(
    () => SkillCatalog.findAll({ filters: { status: 'Active' }, sorts: [{ field: 'name', dir: 'asc' }] }),
    (error: unknown) => {
      assert.match(String((error as Error).message), /Database read failed for SkillCatalog/);
      assert.match(String((error as Error).message), /requires an index/);
      assert.equal((error as Error & { cause?: unknown }).cause, indexError);
      return true;
    },
  );
  await assert.rejects(
    () => SkillCatalog.findOne({ filters: { email: 'person@example.invalid' } }),
    /Database read failed for SkillCatalog: 9 FAILED_PRECONDITION: The query requires an index\./,
  );
});

test('a query that matches nothing stays an empty result', async () => {
  state.read = 'empty';
  assert.deepEqual(await SkillCatalog.findAll({}), { records: [], hasMore: false });
  assert.equal(await SkillCatalog.findOne({ id: 'missing' }), undefined);
});

test('a failed delete is rejected and does not report the record as removed', async () => {
  state.read = 'found';
  state.deleteFails = true;
  await assert.rejects(
    () => SkillCatalog.delete({ id: 'rec-1' }),
    /Database delete failed for SkillCatalog: UNAVAILABLE: Firestore is unavailable/,
  );
});

test('a successful delete still returns the removed record', async () => {
  state.read = 'found';
  state.deleteFails = false;
  const removed = await SkillCatalog.delete({ id: 'rec-1' });
  assert.equal(removed.id, 'rec-1');
  assert.equal(removed.name, 'kept');
});
