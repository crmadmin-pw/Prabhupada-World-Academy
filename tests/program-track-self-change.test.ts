import assert from 'node:assert/strict';
import test from 'node:test';

import registerBvMember from '../src/api/registerBvMember';
import registerUser from '../src/api/registerUser';
import updateUserProfile from '../src/api/updateUserProfile';
import { BvMemberRegistrations, Guides, Users } from '../src/lib/app-backend-sdk';

const bvInput = {
  fullName: 'Track Member',
  phoneCountryCode: '+91',
  phone: '9876500001',
  whatsappCountryCode: '+91',
  whatsappNumber: '9876500001',
  dob: '01/01/2000',
  ashrayLevel: 'Sadhana',
  pwClassesAttending: 'None',
  inTouchWithTemple: false,
  timePreference: '7:45 PM – 8:15 PM (Everyday)',
  segment: 'FOLK' as const,
};

test('a member cannot move to the other program by selecting its guide', async () => {
  const user = {
    id: 'program-self-user',
    email: 'program-self@example.test',
    segment: 'FOLK',
    isPrabhupadaWorldUser: false,
    role: 'User',
  };
  const guide = {
    id: 'program-pw-guide',
    guideId: 'GUIDE-PW-SELF',
    segment: 'PW',
    isPrabhupadaWorldMentor: true,
    fullName: 'PW Admin',
  };

  try {
    await Users.create({ record: user });
    await Guides.create({ record: guide });

    await assert.rejects(
      () => updateUserProfile.execute({ input: { guideId: guide.id }, context: { user } } as never),
      /cannot change your program/,
    );

    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.segment, 'FOLK');
    assert.equal(stored?.isPrabhupadaWorldUser, false);
    assert.notEqual(stored?.guide, guide.id);
  } finally {
    await Users.delete({ id: user.id }).catch(() => undefined);
    await Guides.delete({ id: guide.id }).catch(() => undefined);
  }
});

test('selecting a guide in the same program does not rewrite the program', async () => {
  const user = {
    id: 'program-same-user',
    email: 'program-same@example.test',
    segment: 'FOLK',
    isPrabhupadaWorldUser: false,
    role: 'User',
  };
  const guide = {
    id: 'program-folk-guide',
    guideId: 'GUIDE-FOLK-SELF',
    segment: 'FOLK',
    fullName: 'FOLK Guide',
  };

  try {
    await Users.create({ record: user });
    await Guides.create({ record: guide });

    const result = await updateUserProfile.execute({
      input: { guideId: guide.id },
      context: { user },
    } as never);
    assert.equal(result.success, true);

    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.guide, guide.id);
    assert.equal(stored?.segment, 'FOLK');
    assert.equal(stored?.isPrabhupadaWorldUser, false);
  } finally {
    await Users.delete({ id: user.id }).catch(() => undefined);
    await Guides.delete({ id: guide.id }).catch(() => undefined);
  }
});

test('the Bhakti Vriksha form cannot move a member onto the other program', async () => {
  const user = {
    id: 'program-bv-user',
    userId: 'USER-PROGRAM-BV',
    email: 'program-bv@example.test',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    status: 'Active',
  };

  try {
    await Users.create({ record: user });
    await assert.rejects(
      () => registerBvMember.execute({
        input: bvInput,
        context: { user: { id: user.id, email: user.email } },
      } as never),
      /cannot change your program/,
    );
    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.segment, 'PW');
    assert.equal(stored?.isPrabhupadaWorldUser, true);
  } finally {
    await BvMemberRegistrations.delete({ id: `BVREG-${user.id}` }).catch(() => undefined);
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});

test('registration cannot move an existing member onto the other program', async () => {
  const user = {
    id: 'program-register-user',
    userId: 'USER-PROGRAM-REG',
    email: 'program-register@example.test',
    status: 'Rejected',
    segment: 'FOLK',
    isPrabhupadaWorldUser: false,
    guide: 'old-folk-guide',
  };

  try {
    await Users.create({ record: user });
    await assert.rejects(
      () => (registerUser as any).execute({
        input: {
          fullName: 'Track Member',
          phoneCountryCode: '+91',
          phone: '9876500002',
          phoneE164: '+919876500002',
          email: user.email,
          residencyUserClaim: false,
          isPrabhupadaWorldUser: true,
        },
        context: { user: { id: user.id, email: user.email, role: 'User' } },
      }),
      /cannot change your program/,
    );
    const stored = await Users.findOne({ id: user.id });
    assert.equal(stored?.segment, 'FOLK');
    assert.equal(stored?.isPrabhupadaWorldUser, false);
  } finally {
    await Users.delete({ id: user.id }).catch(() => undefined);
  }
});
