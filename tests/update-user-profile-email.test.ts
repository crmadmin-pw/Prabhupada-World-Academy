import assert from 'node:assert/strict';
import test from 'node:test';

import updateUserProfile from '../src/api/updateUserProfile';
import { Users } from '../src/lib/app-backend-sdk';

test('updateUserProfile writes the verified login email onto the profile', async () => {
  const user = {
    id: 'profile-email-user',
    email: 'Profile.Owner@example.test',
    emailVerified: true,
    role: 'User',
  };

  try {
    await Users.create({ record: { id: user.id, fullName: 'Owner', role: 'User' } });

    const result = await updateUserProfile.execute({
      input: { email: 'profile.owner@example.test' },
      context: { user },
    } as never);
    assert.equal(result.success, true);

    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.email, 'profile.owner@example.test');
  } finally {
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});

test('updateUserProfile rejects an email that is not the verified login', async () => {
  const user = {
    id: 'profile-email-reject',
    email: 'kept@example.test',
    emailVerified: true,
    role: 'User',
  };

  try {
    await Users.create({ record: { id: user.id, email: 'kept@example.test', fullName: 'Kept' } });

    await assert.rejects(
      () => updateUserProfile.execute({
        input: { email: 'other@example.test', fullName: 'Changed' },
        context: { user },
      } as never),
      /verified login email/,
    );

    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.email, 'kept@example.test');
    assert.equal(stored?.fullName, 'Kept');
  } finally {
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});

test('updateUserProfile does not attach an email that another profile already has', async () => {
  const owner = { id: 'profile-email-owner', email: 'shared@example.test' };
  const caller = {
    id: 'profile-email-caller',
    email: 'shared@example.test',
    emailVerified: true,
    role: 'User',
  };

  try {
    await Users.create({ record: { id: owner.id, email: owner.email, fullName: 'Owner' } });
    await Users.create({ record: { id: caller.id, email: 'caller@example.test', fullName: 'Caller' } });

    await assert.rejects(
      () => updateUserProfile.execute({
        input: { email: 'shared@example.test' },
        context: { user: caller },
      } as never),
      /another profile/,
    );

    const stored = await Users.findOne({ id: caller.id });
    assert.equal(stored?.email, 'caller@example.test');
  } finally {
    await Users.delete({ id: owner.id }).catch(() => undefined);
    await Users.delete({ id: caller.id }).catch(() => undefined);
  }
});
