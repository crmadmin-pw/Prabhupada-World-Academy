import assert from 'node:assert/strict';
import test from 'node:test';

import registerBvMember from '../src/api/registerBvMember';
import { BvMemberRegistrations, Users } from '../src/lib/app-backend-sdk';

const input = {
  fullName: 'Once Only Devotee',
  phoneCountryCode: '+91',
  phone: '9876543210',
  whatsappCountryCode: '+91',
  whatsappNumber: '9876543210',
  address: 'Temple Road',
  occupation: 'Service',
  companyName: 'Temple',
  dob: '01/01/2000',
  gender: 'Male' as const,
  dailyChantingRounds: 16,
  weeklyReadingHours: '30',
  weeklyHearingHours: '30',
  ashrayLevel: 'Sadhana',
  pwClassesAttending: 'None',
  inTouchWithTemple: false,
  timePreference: '7:45 PM – 8:15 PM (Everyday)',
  segment: 'PW' as const,
};

test('the Bhakti Vriksha form cannot be submitted again after the first time', async () => {
  const user = {
    id: 'BV-ONCE-USER-DOC',
    userId: 'BV-ONCE-USER',
    email: 'bv-once@example.invalid',
    fullName: 'Once Only Devotee',
    status: 'Active',
    segment: 'PW',
  };
  const registrationId = `BVREG-${user.id}`;
  const context = { user: { id: user.id, email: user.email } };

  try {
    await Users.create({ record: user });
    const first = await registerBvMember.execute({ input, context } as never);
    assert.equal(first.status, 'Pending Approval');

    await assert.rejects(
      () => registerBvMember.execute({ input, context } as never),
      /cannot be filled again/,
    );
    assert.equal((await BvMemberRegistrations.findOne({ id: registrationId }))?.status, 'Pending Approval');

    await Users.update({ id: user.id, record: { bvRegistrationStatus: 'Approved' } });
    await BvMemberRegistrations.update({ id: registrationId, record: { status: 'Approved' } });
    await assert.rejects(
      () => registerBvMember.execute({ input, context } as never),
      /cannot be filled again/,
    );
    assert.equal((await Users.findOne({ id: user.id }))?.bvRegistrationStatus, 'Approved');
  } finally {
    await BvMemberRegistrations.delete({ id: registrationId }).catch(() => undefined);
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});
