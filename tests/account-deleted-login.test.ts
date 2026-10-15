import assert from 'node:assert/strict';
import test from 'node:test';
import { Users } from '../src/lib/app-backend-sdk';
import resolveUserLogin from '../src/api/resolveUserLogin';
import { ACCOUNT_DELETED_LOGIN_MESSAGE } from '../src/lib/accountDeletionPolicy';

const deleted = {
  id: 'profile-1',
  userId: 'USER-001',
  email: 'member@example.test',
  fullName: 'Deleted Member',
  role: 'User',
  status: 'Account Deleted',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
};

test('a deleted Prabhupada World account cannot sign back in', async t => {
  const updates: any[] = [];
  t.mock.method(Users, 'findOne', async () => deleted);
  t.mock.method(Users, 'update', async (change: any) => { updates.push(change); return change; });
  const result = await (resolveUserLogin as any).execute({
    input: {},
    context: { user: { id: 'profile-1', uid: 'auth-1', email: deleted.email } },
  });
  assert.equal(result.action, 'account_deleted');
  assert.equal(result.message, ACCOUNT_DELETED_LOGIN_MESSAGE);
  assert.equal(updates.length, 0);
});

test('a new sign-in for a deleted email is stopped before registration', async t => {
  t.mock.method(Users, 'findOne', async () => undefined);
  t.mock.method(Users, 'findAll', async (query: any) => ({
    records: query.filters?.email === deleted.email ? [deleted] : [],
    hasMore: false,
  }));
  const result = await (resolveUserLogin as any).execute({
    input: {},
    context: { user: { id: 'new-auth', uid: 'new-auth', email: deleted.email } },
  });
  assert.equal(result.action, 'account_deleted');
  assert.equal(result.message, ACCOUNT_DELETED_LOGIN_MESSAGE);
});
