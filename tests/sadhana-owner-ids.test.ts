import assert from 'node:assert/strict';
import test from 'node:test';
import { Users } from '../src/lib/app-backend-sdk';
import { sadhanaOwnerIds } from '../src/lib/sadhanaOwnerIds';

test('a dashboard profile alias with the same email can open its saved entry', async t => {
  t.mock.method(Users, 'findOne', async () => ({ id: 'old-document', userId: 'old-public', email: 'member@example.invalid' }));
  assert.deepEqual(await sadhanaOwnerIds(
    'current-document', 'auth-uid', 'member@example.invalid',
    { userId: 'current-public', email: 'member@example.invalid' }, 'old-public',
  ), ['current-document', 'auth-uid', 'current-public', 'old-document', 'old-public']);
});

test('another member alias cannot be used to read or overwrite their entry', async t => {
  t.mock.method(Users, 'findOne', async () => ({ id: 'other-document', userId: 'other-public', email: 'other@example.invalid' }));
  assert.deepEqual(await sadhanaOwnerIds(
    'current-document', 'auth-uid', 'member@example.invalid',
    { userId: 'current-public', email: 'member@example.invalid' }, 'other-public',
  ), ['current-document', 'auth-uid', 'current-public']);
});
