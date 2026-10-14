import assert from 'node:assert/strict';
import test from 'node:test';
import { BvGroupMembers, BvGroups, Users } from '../src/lib/app-backend-sdk';
import setPwSadhanaTargets from '../src/api/setPwSadhanaTargets';

const rgf = {
  id: 'PW-TARGET-RGF-DB',
  userId: 'PW-TARGET-RGF',
  email: 'pw-target-rgf@example.invalid',
  fullName: 'Target RGF',
  role: 'User',
  status: 'Active',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvFacilitator: true,
  isBvsl: true,
};

const unmarkedMember = {
  id: 'PW-TARGET-MEMBER-DB',
  userId: 'PW-TARGET-MEMBER',
  email: 'pw-target-member@example.invalid',
  fullName: 'Unmarked Member',
  role: 'User',
  status: 'Active',
  bvReportingFacilitatorId: rgf.userId,
};

const folkMember = {
  id: 'PW-TARGET-FOLK-DB',
  userId: 'PW-TARGET-FOLK',
  email: 'pw-target-folk@example.invalid',
  fullName: 'Folk Member',
  role: 'User',
  status: 'Active',
  segment: 'FOLK',
  bvReportingFacilitatorId: rgf.userId,
};

const group = {
  id: 'PW-TARGET-GROUP-DB',
  groupId: 'PW-TARGET-GROUP',
  groupName: 'PW Target Group',
  segment: 'PW',
  isActive: true,
  bvslId: rgf.userId,
  bvslLeader: rgf.id,
};

test('an RGF can assign sadhana targets when the member profile is missing its Prabhupada World flag', async () => {
  const membershipId = 'PW-TARGET-MEMBERSHIP';
  try {
    await Users.create({ record: rgf });
    await Users.create({ record: unmarkedMember });
    await BvGroups.create({ record: group });
    await BvGroupMembers.create({
      record: {
        id: membershipId,
        group: group.id,
        groupId: group.groupId,
        user: unmarkedMember.id,
        userId: unmarkedMember.userId,
        role: 'Member',
      },
    });

    const result = await setPwSadhanaTargets.execute({
      input: { userId: unmarkedMember.userId, chantingRounds: 8, readingMinutes: 30 },
      context: { user: rgf },
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.pwChantingTarget, 8);
    assert.equal(result.pwReadingTarget, 30);
    const saved = await Users.findOne({ id: unmarkedMember.id, fields: ['segment', 'isPrabhupadaWorldUser', 'pwChantingTarget', 'pwReadingTarget'] });
    assert.equal(saved.segment, 'PW');
    assert.equal(saved.isPrabhupadaWorldUser, true);
    assert.equal(saved.pwChantingTarget, 8);
    assert.equal(saved.pwReadingTarget, 30);
  } finally {
    await BvGroupMembers.delete({ id: membershipId }).catch(() => undefined);
    await BvGroups.delete({ id: group.id }).catch(() => undefined);
    await Users.delete({ id: unmarkedMember.id }).catch(() => undefined);
    await Users.delete({ id: rgf.id }).catch(() => undefined);
  }
});

test('a FOLK member outside a Prabhupada World group still cannot receive sadhana targets', async () => {
  try {
    await Users.create({ record: rgf });
    await Users.create({ record: folkMember });
    await assert.rejects(
      () => setPwSadhanaTargets.execute({
        input: { userId: folkMember.userId, chantingRounds: 4, readingMinutes: 15 },
        context: { user: rgf },
      } as never),
      /Prabhupada World members/,
    );
  } finally {
    await Users.delete({ id: folkMember.id }).catch(() => undefined);
    await Users.delete({ id: rgf.id }).catch(() => undefined);
  }
});
