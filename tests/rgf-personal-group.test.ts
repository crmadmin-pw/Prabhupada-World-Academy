import assert from 'node:assert/strict';
import test from 'node:test';

import getBvslGroups from '../src/api/getBvslGroups';
import { BvGroupMembers, BvGroups, Users } from '../src/lib/app-backend-sdk';
import { resolveBvScopedGroups } from '../src/lib/bvGroupMemberScope';

const punya = {
  id: 'PUNYA-RGF-DB',
  userId: 'PUNYA-RGF',
  email: 'punya-rgf@example.invalid',
  fullName: 'Punya',
  role: 'User',
  status: 'Active',
  segment: 'PW',
  isPrabhupadaWorldUser: true,
  isBvFacilitator: true,
  isBvsl: true,
  bvGroupId: 'PUNYA-ASSIGNED-GROUP-DB',
  bvGroupName: 'Punya Reading Group',
};

const assignedGroup = {
  id: 'PUNYA-ASSIGNED-GROUP-DB',
  groupId: 'PUNYA-ASSIGNED-GROUP',
  groupName: 'Punya Reading Group',
  description: 'Visible on personal sadhana',
  bvslId: 'PREVIOUS-FACILITATOR',
  bvslLeader: 'PREVIOUS-FACILITATOR',
  bvslName: 'Previous Facilitator',
  segment: 'PW',
  isActive: true,
};

const namedGroup = {
  id: 'PUNYA-NAMED-GROUP-DB',
  groupId: 'PUNYA-NAMED-GROUP',
  groupName: 'Legacy Name Group',
  bvslLeader: 'Punya',
  bvslName: 'Punya',
  segment: 'PW',
  isActive: true,
};

const otherGroup = {
  id: 'PUNYA-OTHER-GROUP-DB',
  groupId: 'PUNYA-OTHER-GROUP',
  groupName: 'Someone Else',
  bvslId: 'SOME-OTHER-RGF',
  bvslName: 'Someone Else',
  segment: 'PW',
  isActive: true,
};

test('RGF groups tab includes the reading group shown on personal sadhana', async () => {
  const membershipId = 'PUNYA-MEMBERSHIP-ONLY';
  const membershipGroup = {
    id: 'PUNYA-MEMBERSHIP-GROUP-DB',
    groupId: 'PUNYA-MEMBERSHIP-GROUP',
    groupName: 'Membership Reading Group',
    bvslId: 'ANOTHER-FACILITATOR',
    bvslName: 'Another Facilitator',
    segment: 'PW',
    isActive: true,
  };
  const memberOnly = {
    ...punya,
    id: 'PUNYA-MEMBER-ONLY-DB',
    userId: 'PUNYA-MEMBER-ONLY',
    fullName: 'Punya Member',
    email: 'punya-member-only@example.invalid',
    bvGroupId: '',
    bvGroupName: '',
  };

  await Users.create({ record: punya });
  await Users.create({ record: memberOnly });
  await BvGroups.create({ record: assignedGroup });
  await BvGroups.create({ record: namedGroup });
  await BvGroups.create({ record: otherGroup });
  await BvGroups.create({ record: membershipGroup });
  await BvGroupMembers.create({
    record: { id: membershipId, user: memberOnly.id, group: membershipGroup.id },
  });

  try {
    const result = await getBvslGroups.execute({
      input: { bvslId: punya.userId },
      context: { user: punya },
    } as never);
    const groupIds = result.groups.map((group: any) => group.groupId).sort();
    assert.deepEqual(groupIds, [assignedGroup.groupId, namedGroup.groupId].sort());

    const fromMembership = await getBvslGroups.execute({
      input: { bvslId: memberOnly.userId },
      context: { user: memberOnly },
    } as never);
    assert.deepEqual(fromMembership.groups.map((group: any) => group.groupId), [membershipGroup.groupId]);

    const devotee = { ...punya, id: 'PUNYA-DEVOTEE-DB', userId: 'PUNYA-DEVOTEE', email: 'punya-devotee@example.invalid', isBvFacilitator: false, isBvsl: false };
    await Users.create({ record: devotee });
    const devoteeScope = await resolveBvScopedGroups(devotee);
    assert.equal(devoteeScope.some(group => group.id === assignedGroup.id), false);
  } finally {
    await BvGroupMembers.delete({ id: membershipId }).catch(() => undefined);
    await BvGroups.delete({ id: assignedGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: namedGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: otherGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: membershipGroup.id }).catch(() => undefined);
    await Users.delete({ id: punya.id }).catch(() => undefined);
    await Users.delete({ id: memberOnly.id }).catch(() => undefined);
    await Users.delete({ id: 'PUNYA-DEVOTEE-DB' }).catch(() => undefined);
  }
});
