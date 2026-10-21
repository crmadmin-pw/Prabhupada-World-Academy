import assert from 'node:assert/strict';
import test from 'node:test';

import getGuideGroupStats from '../src/api/getGuideGroupStats';
import getBvslGroups from '../src/api/getBvslGroups';
import { BvGroups, Users } from '../src/lib/app-backend-sdk';

test('group stats hide orphan groups but retain a valid empty RGF group', async () => {
  const superAdmin = {
    id: 'GROUP-VALIDITY-SUPER-ADMIN', userId: 'GROUP-VALIDITY-SUPER-ADMIN',
    email: 'group-validity-admin@example.invalid', fullName: 'Group Validity Admin',
    role: 'SUPER_ADMIN', status: 'Active', segment: 'PW', isBvSuperAdmin: true,
  };
  const rgf = {
    id: 'GROUP-VALIDITY-RGF-DB', userId: 'GROUP-VALIDITY-RGF',
    email: 'group-validity-rgf@example.invalid', fullName: 'Valid Empty Group RGF',
    role: 'BVSL', status: 'Active', segment: 'PW', isBvFacilitator: true, isBvsl: true,
  };
  const validGroup = {
    id: 'GROUP-VALIDITY-ACTIVE-DB', groupId: 'GROUP-VALIDITY-ACTIVE',
    groupName: 'Valid Empty Group', segment: 'PW', isActive: true, bvslId: rgf.userId,
  };
  const orphanGroup = {
    id: 'GROUP-VALIDITY-ORPHAN-DB', groupName: 'Orphan Empty Group',
    segment: 'PW', isActive: true, bvslId: 'DELETED-GROUP-VALIDITY-RGF',
  };

  try {
    await Users.create({ record: superAdmin });
    await Users.create({ record: rgf });
    await BvGroups.create({ record: validGroup });
    await BvGroups.create({ record: orphanGroup });

    const result = await getGuideGroupStats.execute({
      input: { guideId: 'ALL', segment: 'PW' },
      context: { user: superAdmin },
    } as never);

    const validCard = result.groups.find((group: any) => group.groupId === validGroup.groupId);
    assert.equal(validCard?.memberCount, 1);
    assert.ok(!result.groups.some((group: any) => group.groupName === orphanGroup.groupName));

    const listed = await getBvslGroups.execute({
      input: { bvslId: rgf.userId },
      context: { user: rgf },
    } as never);
    assert.equal(listed.groups.find((group: any) => group.groupId === validGroup.groupId)?.memberCount, 1);
  } finally {
    await BvGroups.delete({ id: validGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: orphanGroup.id }).catch(() => undefined);
    await Users.delete({ id: rgf.id }).catch(() => undefined);
    await Users.delete({ id: superAdmin.id }).catch(() => undefined);
  }
});
