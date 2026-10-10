import assert from 'node:assert/strict';
import test from 'node:test';

import lookupPhone from '../src/api/lookupPhone';
import { Users } from '../src/lib/app-backend-sdk';

function caller(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.test`,
    emailVerified: true,
    isRegistered: true,
    isActive: true,
    capabilities: [],
    ...extra,
  };
}

test('a member can learn that a phone is registered, not which status it has', async () => {
  const memberId = 'lookup-member';
  const otherId = 'lookup-other';
  try {
    await Users.create({ record: { id: memberId, userId: 'USER-LOOKUP-1', phone: '9000000001', status: 'Active', email: 'lookup-member@example.test' } });
    await Users.create({ record: { id: otherId, userId: 'USER-LOOKUP-2', phone: '9000000002', status: 'Rejected', email: 'lookup-other@example.test' } });

    const result = await lookupPhone.execute({
      input: { phone: '9000000002', countryCode: '+91' },
      context: { user: caller(memberId) },
    } as never);

    assert.deepEqual(result, { found: true });
  } finally {
    await Users.delete({ id: memberId }).catch(() => undefined);
    await Users.delete({ id: otherId }).catch(() => undefined);
  }
});

test('status is revealed for the caller’s own number and for an approver', async () => {
  const memberId = 'lookup-self';
  const approverId = 'lookup-approver';
  try {
    await Users.create({ record: { id: memberId, userId: 'USER-LOOKUP-3', phone: '9000000011', status: 'Pending Approval', email: 'lookup-self@example.test' } });
    await Users.create({ record: { id: approverId, userId: 'USER-LOOKUP-4', phone: '9000000012', status: 'Active', email: 'lookup-approver@example.test' } });

    const own = await lookupPhone.execute({
      input: { phone: '9000000011', countryCode: '+91' },
      context: { user: caller(memberId) },
    } as never);
    assert.equal(own.status, 'pending');

    const approved = await lookupPhone.execute({
      input: { phone: '9000000011', countryCode: '+91' },
      context: { user: caller(approverId, { capabilities: ['users.approve'] }) },
    } as never);
    assert.equal(approved.status, 'pending');
  } finally {
    await Users.delete({ id: memberId }).catch(() => undefined);
    await Users.delete({ id: approverId }).catch(() => undefined);
  }
});

test('a signed-in account that is not active cannot look up a phone', async () => {
  await assert.rejects(
    () => lookupPhone.execute({
      input: { phone: '9000000021', countryCode: '+91' },
      context: { user: caller('lookup-pending', { isActive: false, isRegistered: true }) },
    } as never),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'FORBIDDEN');
      return true;
    },
  );
});

test('each person gets only a few phone lookups per hour', async () => {
  const id = 'lookup-limited';
  try {
    await Users.create({ record: { id, userId: 'USER-LOOKUP-5', phone: '9000000031', status: 'Active', email: 'lookup-limited@example.test' } });
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await lookupPhone.execute({
        input: { phone: `900000004${attempt}`, countryCode: '+91' },
        context: { user: caller(id) },
      } as never);
      assert.equal(result.found, false);
    }
    await assert.rejects(
      () => lookupPhone.execute({
        input: { phone: '9000000099', countryCode: '+91' },
        context: { user: caller(id) },
      } as never),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'TOO_MANY_REQUESTS');
        return true;
      },
    );

    const other = await lookupPhone.execute({
      input: { phone: '9000000088', countryCode: '+91' },
      context: { user: caller('lookup-limited-other') },
    } as never);
    assert.equal(other.found, false);
  } finally {
    await Users.delete({ id }).catch(() => undefined);
  }
});
