import assert from 'node:assert/strict';
import test from 'node:test';
import submit from '../src/api/submitSadhana';
import { Users, SadhanaEntries } from '../src/lib/app-backend-sdk';

test('FOLK can edit an old entry and its authenticated owner is preserved', async t => {
  const user = { id: 'member-db', userId: 'USER-OLD', status: 'Active', segment: 'FOLK' };
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(SadhanaEntries, 'findOne', async ({ filters }: any) => filters.user === user.id
    ? { id: 'old-row', entryId: 'ENTRY-OLD', user: user.id, entryDate: '2020-01-01' } : null);
  let saved: any;
  t.mock.method(SadhanaEntries, 'update', async (input: any) => { saved = input; });
  t.mock.method(SadhanaEntries, 'create', async () => assert.fail('Editing must not create a duplicate'));
  const result = await submit.execute({ input: { userId: 'someone-else', entryDate: '2020-01-01', totalScore: 0, fieldValues: {} }, context: { user } } as any);
  assert.equal(result.isUpdate, true);
  assert.equal(saved.id, 'old-row');
  assert.equal(saved.record.user, user.id);
  assert.equal(saved.record.entryDate, '2020-01-01');
});

test('PW retains its seven-day edit window regardless of client-supplied fields', async t => {
  const user = { id: 'pw-member', segment: 'PW', status: 'Active' };
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(SadhanaEntries, 'update', async () => assert.fail('PW old entry must not be saved'));
  await assert.rejects(() => submit.execute({ input: { userId: user.id, entryDate: '2020-01-01', totalScore: 0, fieldValues: {}, segment: 'FOLK' }, context: { user } } as any), /older than 7 days/);
});

test('FOLK cannot save tomorrow, including around midnight in India', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T19:00:00Z').getTime() });
  const user = { id: 'folk-member', segment: 'FOLK', status: 'Active' };
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(SadhanaEntries, 'findOne', async () => assert.fail('Future date must be rejected before entry access'));
  await assert.rejects(() => submit.execute({ input: { userId: user.id, entryDate: '2026-10-07', totalScore: 0, fieldValues: {} }, context: { user } } as any), /future date/);
});
