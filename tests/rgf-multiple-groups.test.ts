import assert from 'node:assert/strict';
import test from 'node:test';

import assignBvRole from '../src/api/assignBvRole';
import getAllBvGroupsAdmin, { facilitatorIdentityRefs } from '../src/api/getAllBvGroupsAdmin';
import getBvslGroups from '../src/api/getBvslGroups';
import getGuideUsers from '../src/api/getGuideUsers';
import { AppError, BvGroupMembers, BvGroups, Users } from '../src/lib/app-backend-sdk';

const rgf = {
  id: 'MULTI-RGF-DB',
  userId: 'MULTI-RGF',
  email: 'multi-rgf@example.invalid',
  fullName: 'Multi RGF',
  role: 'User',
  status: 'Active',
  segment: 'PW',
  isBvFacilitator: true,
  isBvsl: true,
};

const member = {
  id: 'MULTI-MEMBER-DB',
  userId: 'MULTI-MEMBER',
  email: 'multi-member@example.invalid',
  fullName: 'Multi Member',
  role: 'User',
  status: 'Active',
  segment: 'PW',
};

const monday = {
  id: 'MULTI-MONDAY-DB',
  groupId: 'MULTI-MONDAY',
  groupName: 'Monday Reading Group',
  bvslLeader: rgf.id,
  bvslId: rgf.userId,
  bvslName: rgf.fullName,
  segment: 'PW',
  isActive: true,
};

const thursday = {
  id: 'MULTI-THURSDAY-DB',
  groupId: 'MULTI-THURSDAY',
  groupName: 'Thursday Reading Group',
  bvslLeader: rgf.id,
  bvslId: rgf.userId,
  bvslName: rgf.fullName,
  segment: 'PW',
  isActive: true,
};

const superAdmin = {
  user: {
    id: 'multi-super-admin',
    email: 'multi-super@example.invalid',
    fullName: 'Super Admin',
    role: 'SUPER_ADMIN',
    isBvSuperAdmin: true,
    capabilities: ['*'],
  },
};

test('facilitator identity keeps every stored id, and a name only when no id exists', () => {
  assert.deepEqual(facilitatorIdentityRefs({ bvslLeader: rgf.id, bvslId: rgf.userId }).sort(), [rgf.id, rgf.userId].sort());
  assert.deepEqual(facilitatorIdentityRefs({ bvslId: rgf.userId }), [rgf.userId]);
  assert.deepEqual(facilitatorIdentityRefs({ bvslName: rgf.fullName }), [rgf.fullName]);
  assert.deepEqual(
    facilitatorIdentityRefs({ bvslLeader: rgf.id, bvslName: rgf.fullName }).sort(),
    [rgf.id, rgf.fullName].sort(),
  );
});

test('one RGF can facilitate more than one reading group', async () => {
  await Users.create({ record: rgf });
  await Users.create({ record: member });
  await BvGroups.create({ record: monday });
  await BvGroups.create({ record: thursday });

  try {
    const listed = await getBvslGroups.execute({
      input: { bvslId: rgf.userId },
      context: { user: rgf },
    } as never);
    assert.deepEqual(
      listed.groups.map((group: any) => group.groupId).sort(),
      [monday.groupId, thursday.groupId].sort(),
    );

    await assert.rejects(
      () => assignBvRole.execute({
        input: { userId: member.id, role: 'MEMBER', parentId: rgf.id },
        context: superAdmin,
      } as never),
      (error: any) => error instanceof AppError && error.code === 'CONFLICT',
    );

    const assigned = await assignBvRole.execute({
      input: { userId: member.id, role: 'MEMBER', parentId: rgf.id, groupId: thursday.groupId },
      context: superAdmin,
    } as never);
    assert.equal(assigned.success, true);

    const updated = await Users.findOne({ id: member.id });
    assert.equal(updated.bvGroupId, thursday.id);
    assert.equal(updated.bvGroupName, thursday.groupName);

    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { user: member.id },
      limit: 20,
    });
    assert.deepEqual(memberships.map((row: any) => row.group), [thursday.id]);

    const stillLed = await getBvslGroups.execute({
      input: { bvslId: rgf.userId },
      context: { user: rgf },
    } as never);
    assert.deepEqual(
      stillLed.groups.map((group: any) => group.groupId).sort(),
      [monday.groupId, thursday.groupId].sort(),
    );

    const directory = await getGuideUsers.execute({
      input: { guideId: 'ALL', statusFilter: 'all', segment: 'PW' },
      context: superAdmin,
    } as never);
    const listedRgf = directory.users.find((user: any) => user.userDbId === rgf.userId || user.email === rgf.email);
    assert.deepEqual(
      [...(listedRgf?.facilitatedGroupNames || [])].sort(),
      [monday.groupName, thursday.groupName].sort(),
    );

    const adminGroups = await getAllBvGroupsAdmin.execute({
      input: { guideId: superAdmin.user.id, departmentWide: true, segment: 'PW' },
      context: superAdmin,
    } as never);
    const ledByAdminList = adminGroups.groups.filter((group: any) =>
      [monday.groupId, thursday.groupId].includes(group.groupId),
    );
    assert.equal(ledByAdminList.length, 2);
    for (const group of ledByAdminList) {
      assert.ok(group.facilitatorIds.includes(rgf.id) || group.facilitatorIds.includes(rgf.userId));
    }
  } finally {
    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { user: member.id },
      limit: 20,
    });
    await Promise.all(memberships.map((row: any) => BvGroupMembers.delete({ id: row.id }).catch(() => undefined)));
    await BvGroups.delete({ id: monday.id }).catch(() => undefined);
    await BvGroups.delete({ id: thursday.id }).catch(() => undefined);
    await Users.delete({ id: rgf.id }).catch(() => undefined);
    await Users.delete({ id: member.id }).catch(() => undefined);
  }
});
