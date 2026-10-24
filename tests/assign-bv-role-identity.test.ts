import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, BvGroups } from '../src/lib/app-backend-sdk';
import assignBvRole from '../src/api/assignBvRole';

const parent = {
  id: 'parent-auth',
  userId: 'USER-001',
  email: 'parent@example.test',
  fullName: 'Parent Das',
  role: 'User',
  isBvSupervisor: true,
};

const realMember = {
  id: 'auth-uid-1',
  userId: 'USER-045',
  email: 'member@example.test',
  fullName: 'Real Member',
  role: 'User',
};

function mockDirectory(t: any, records: any[]) {
  const updates: { id: string; record: any }[] = [];
  t.mock.method(Users, 'findOne', async (query: any) =>
    records.find(record => record.id === query.id) || null);
  t.mock.method(Users, 'findAll', async (query: any) => {
    const filters = query?.filters || {};
    let matched = records;
    if (filters.userId) {
      matched = records.filter(record => String(record.userId || '').toLowerCase() === String(filters.userId).toLowerCase());
    } else if (filters.email) {
      matched = records.filter(record => String(record.email || '').toLowerCase() === String(filters.email).toLowerCase());
    }
    return { records: matched, hasMore: false };
  });
  t.mock.method(Users, 'update', async (change: any) => {
    updates.push(change);
    return change;
  });
  return updates;
}

const superAdmin = {
  user: {
    id: 'super-admin',
    email: 'super@example.test',
    fullName: 'Super Admin',
    role: 'SUPER_ADMIN',
    isBvSuperAdmin: true,
    capabilities: ['*'],
  },
};

const pwAdmin = { user: { id: 'pw-admin', email: 'admin@example.test', role: 'ADMIN', segment: 'PW', isBvAdmin: true, capabilities: ['bv.roles.assign'] } };

test('PW admin can assign RGF while preserving an existing BV Admin flag', async t => {
  const member = { ...realMember, segment: 'PW', isBvAdmin: true };
  const updates = mockDirectory(t, [member, parent]);
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [], hasMore: false }));
  for (const isAdmin of [undefined, true]) {
    await assignBvRole.execute({
      input: { userId: member.userId, role: 'FACILITATOR', parentId: parent.id, multiRoles: { isAdmin, isFacilitator: true } },
      context: pwAdmin,
    } as never);
  }
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.equal(update.record.isBvAdmin, true);
    assert.equal(update.record.isBvFacilitator, true);
    assert.equal(update.record.isBvsl, true);
    assert.equal(update.record.bvReportingSupervisorId, '');
  }
});

test('PW admin cannot grant or revoke BV Admin, including full unassignment', async t => {
  const admin = { ...realMember, isBvAdmin: true };
  const ordinary = { ...realMember, id: 'ordinary', userId: 'ordinary', isBvAdmin: false };
  const updates = mockDirectory(t, [admin, ordinary]);
  for (const input of [
    { userId: ordinary.id, role: 'ADMIN' },
    { userId: ordinary.id, role: 'FACILITATOR', multiRoles: { isAdmin: true, isFacilitator: true } },
    { userId: admin.id, role: 'FACILITATOR', multiRoles: { isAdmin: false, isFacilitator: true } },
    { userId: admin.id, role: 'MEMBER', isBvMember: false },
  ]) {
    await assert.rejects(assignBvRole.execute({ input, context: pwAdmin } as never), /Only Super Admins/);
  }
  assert.equal(updates.length, 0);
});

test('Super Admin retains permission to grant the BV Admin role', async t => {
  const updates = mockDirectory(t, [realMember]);
  await assignBvRole.execute({ input: { userId: realMember.id, role: 'ADMIN', multiRoles: { isAdmin: true } }, context: superAdmin } as never);
  assert.equal(updates[0].record.isBvAdmin, true);
});

test('assigning a group role updates the real profile and does not write alias keys', async (t) => {
  const shadowByNumber = { id: 'USER-045', role: 'User', isBvFacilitator: false };
  const shadowByEmail = { id: 'member@example.test', role: 'User' };
  const updates = mockDirectory(t, [realMember, shadowByNumber, shadowByEmail, parent]);

  const result = await assignBvRole.execute({
    input: { userId: 'USER-045', role: 'FACILITATOR', parentId: 'USER-001' },
    context: superAdmin,
  } as never);

  assert.equal(result.success, true);
  assert.deepEqual(updates.map(update => update.id), ['auth-uid-1']);
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvsl, true);
});

test('assigning a role by email still updates only the auth profile', async (t) => {
  const shadowByEmail = { id: 'member@example.test', role: 'User' };
  const updates = mockDirectory(t, [realMember, shadowByEmail, parent]);

  await assignBvRole.execute({
    input: { userId: 'member@example.test', role: 'SUPERVISOR', parentId: 'parent-auth' },
    context: superAdmin,
  } as never);

  assert.deepEqual(updates.map(update => update.id), ['auth-uid-1']);
  assert.equal(updates[0].record.isBvSupervisor, true);
});

test('a legacy profile whose only id is the member number is updated in place', async (t) => {
  const legacy = {
    id: 'USER-088',
    userId: 'USER-088',
    email: 'legacy@example.test',
    fullName: 'Legacy Member',
    role: 'User',
  };
  const updates = mockDirectory(t, [legacy, parent]);

  await assignBvRole.execute({
    input: { userId: 'legacy@example.test', role: 'FACILITATOR', parentId: 'parent-auth' },
    context: superAdmin,
  } as never);

  assert.deepEqual(updates.map(update => update.id), ['USER-088']);
});

test('changing an RGF to RGSF removes that person from the reading group', async (t) => {
  const parentRgf = {
    id: 'parent-rgf',
    userId: 'PARENT-RGF',
    email: 'parent-rgf@example.test',
    fullName: 'Vedanarayana Dasa',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const former = {
    id: 'former-doc',
    userId: 'FORMER-1',
    email: 'former@example.test',
    fullName: 'F20190150H',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const group = {
    id: 'vdn-doc',
    bvslLeader: ['parent-rgf', 'former-doc'],
    bvslId: ['PARENT-RGF', 'FORMER-1'],
    bvslName: ['Vedanarayana Dasa', 'F20190150H'],
  };
  const updates = mockDirectory(t, [former, parentRgf]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [group, { id: 'other', bvslLeader: 'someone-else', bvslId: 'someone-else', bvslName: 'Someone Else' }], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: { userId: 'FORMER-1', role: 'SUB_FACILITATOR', parentId: 'PARENT-RGF' },
    context: superAdmin,
  } as never);

  assert.equal(updates[0].record.isBvFacilitator, false);
  assert.equal(updates[0].record.isBvsl, false);
  assert.equal(updates[0].record.isBvSubFacilitator, true);
  assert.deepEqual(groupUpdates.map(change => change.id), ['vdn-doc']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'parent-rgf');
  assert.equal(groupUpdates[0].record.bvslId, 'PARENT-RGF');
  assert.equal(groupUpdates[0].record.bvslName, 'Vedanarayana Dasa');
});

test('a PW role change for someone in several groups asks which group and leaves the others', async (t) => {
  const person = {
    id: 'pw-user',
    userId: 'PW-USER',
    email: 'pw@example.test',
    fullName: 'Pw User',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const morning = {
    id: 'group-morning',
    groupId: 'group-morning',
    groupName: 'Morning',
    bvslLeader: 'pw-user',
    bvslId: 'PW-USER',
    bvslName: 'Pw User',
  };
  const evening = {
    id: 'group-evening',
    groupId: 'group-evening',
    groupName: 'Evening',
    bvslLeader: ['other', 'pw-user'],
    bvslId: ['OTHER', 'PW-USER'],
    bvslName: ['Other Das', 'Pw User'],
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [morning, evening], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assert.rejects(
    () => assignBvRole.execute({
      input: { userId: 'PW-USER', role: 'SUB_FACILITATOR', parentId: 'USER-001' },
      context: superAdmin,
    } as never),
    (error: any) => error.code === 'CONFLICT' && /Morning/.test(error.message) && /Evening/.test(error.message),
  );
  assert.equal(groupUpdates.length, 0);
  assert.equal(updates.length, 0);
  assert.equal(morning.bvslLeader, 'pw-user');
});

test('an admin assigns the reading groups a supervisor watches', async (t) => {
  const supervisor = {
    id: 'supervisor-doc',
    userId: 'SUP-1',
    email: 'supervisor@example.test',
    fullName: 'Supervisor Das',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const admin = {
    id: 'admin-doc',
    userId: 'ADMIN-1',
    email: 'admin@example.test',
    fullName: 'Admin Das',
    role: 'Admin',
    isBvAdmin: true,
  };
  const groups = [1, 2, 3, 4].map(index => ({
    id: `watch-${index}`,
    groupId: `watch-${index}`,
    groupName: `Watch ${index}`,
    segment: 'PW',
    bvslId: 'someone-else',
  }));
  const ownGroup = {
    id: 'own-rgf-group',
    groupId: 'own-rgf-group',
    groupName: 'Own RGF Group',
    segment: 'PW',
    bvslId: 'SUP-1',
    bvslLeader: 'supervisor-doc',
    supervisorId: 'supervisor-doc',
    supervisorUserId: 'SUP-1',
  };
  const updates = mockDirectory(t, [supervisor, admin]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [...groups, ownGroup], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: {
      userId: 'SUP-1',
      role: 'SUPERVISOR',
      parentId: 'ADMIN-1',
      supervisedGroupIds: groups.map(group => group.id),
      multiRoles: { isSupervisor: true, isFacilitator: true },
    },
    context: superAdmin,
  } as never);

  assert.deepEqual(groupUpdates.map(change => change.id).sort(), ['own-rgf-group', ...groups.map(group => group.id)].sort());
  for (const group of groups) {
    const written = groupUpdates.find(change => change.id === group.id);
    assert.equal(written?.record.supervisorId, 'supervisor-doc');
    assert.equal(written?.record.supervisorUserId, 'SUP-1');
  }
  const cleared = groupUpdates.find(change => change.id === ownGroup.id);
  assert.equal(cleared?.record.supervisorId, '');
  assert.ok(updates[0].record.bvSupervisedGroupIds.includes('watch-1'));
  assert.equal(updates[0].record.bvSupervisedGroupIds.includes('own-rgf-group'), false);
  assert.equal(updates[0].record.isBvFacilitator, true);
});

test('a PW user can be RGF of one group and RGSF of another', async (t) => {
  const person = {
    id: 'pw-user',
    userId: 'PW-USER',
    email: 'pw@example.test',
    fullName: 'Pw User',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const morning = {
    id: 'group-morning',
    groupId: 'group-morning',
    groupName: 'Morning',
    bvslLeader: 'pw-user',
    bvslId: 'PW-USER',
    bvslName: 'Pw User',
  };
  const evening = {
    id: 'group-evening',
    groupId: 'group-evening',
    groupName: 'Evening',
    bvslLeader: ['other', 'pw-user'],
    bvslId: ['OTHER', 'PW-USER'],
    bvslName: ['Other Das', 'Pw User'],
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [morning, evening], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: {
      userId: 'PW-USER',
      role: 'SUB_FACILITATOR',
      parentId: 'USER-001',
      groupRoles: [{ groupId: 'group-evening', role: 'SUB_FACILITATOR' }],
    },
    context: superAdmin,
  } as never);

  assert.equal(morning.bvslLeader, 'pw-user');
  assert.deepEqual(groupUpdates.map(change => change.id), ['group-evening']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'other');
  assert.equal(groupUpdates[0].record.bvslId, 'OTHER');
  assert.equal(groupUpdates[0].record.subFacilitatorId, 'pw-user');
  assert.equal(groupUpdates[0].record.rgsfId, 'PW-USER');
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvsl, true);
  assert.equal(updates[0].record.isBvSubFacilitator, true);
});

test('a FOLK role change applies only to the chosen group', async (t) => {
  const person = {
    id: 'folk-user',
    userId: 'FOLK-USER',
    email: 'folk@example.test',
    fullName: 'Folk User',
    role: 'User',
    segment: 'FOLK',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const morning = {
    id: 'folk-morning',
    groupId: 'folk-morning',
    groupName: 'Folk Morning',
    segment: 'FOLK',
    bvslLeader: 'folk-user',
    bvslId: 'FOLK-USER',
    bvslName: 'Folk User',
  };
  const evening = {
    id: 'folk-evening',
    groupId: 'folk-evening',
    groupName: 'Folk Evening',
    segment: 'FOLK',
    bvslLeader: 'folk-user',
    bvslId: 'FOLK-USER',
    bvslName: 'Folk User',
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [morning, evening], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assert.rejects(
    () => assignBvRole.execute({
      input: { userId: 'FOLK-USER', role: 'SUB_FACILITATOR', parentId: 'USER-001' },
      context: superAdmin,
    } as never),
    (error: any) => error.code === 'CONFLICT' && /Folk Morning/.test(error.message) && /Folk Evening/.test(error.message),
  );
  assert.equal(groupUpdates.length, 0);
  assert.equal(updates.length, 0);

  await assignBvRole.execute({
    input: {
      userId: 'FOLK-USER',
      role: 'SUB_FACILITATOR',
      parentId: 'USER-001',
      groupRoles: [{ groupId: 'folk-evening', role: 'SUB_FACILITATOR' }],
    },
    context: superAdmin,
  } as never);

  assert.equal(morning.bvslLeader, 'folk-user');
  assert.deepEqual(groupUpdates.map(change => change.id), ['folk-evening']);
  assert.equal(groupUpdates[0].record.subFacilitatorId, 'folk-user');
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvSubFacilitator, true);
});

test('changing an RGF to RGSF removes them when the group stored facilitators as comma-separated text', async (t) => {
  const parentRgf = {
    id: 'parent-rgf',
    userId: 'PARENT-RGF',
    email: 'parent-rgf@example.test',
    fullName: 'Punya',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const former = {
    id: 'former-doc',
    userId: 'FORMER-1',
    email: 'richa@example.test',
    fullName: 'Richa Dewan',
    role: 'User',
    isBvFacilitator: true,
    isBvsl: true,
  };
  const group = {
    id: 'nityananda-doc',
    bvslLeader: 'parent-rgf,former-doc',
    bvslId: 'PARENT-RGF,FORMER-1',
    bvslName: 'Punya, Richa Dewan',
  };
  const updates = mockDirectory(t, [former, parentRgf]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [group], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  await assignBvRole.execute({
    input: { userId: 'FORMER-1', role: 'SUB_FACILITATOR', parentId: 'PARENT-RGF' },
    context: superAdmin,
  } as never);

  assert.equal(updates[0].record.isBvSubFacilitator, true);
  assert.equal(updates[0].record.isBvsl, false);
  assert.deepEqual(groupUpdates.map(change => change.id), ['nityananda-doc']);
  assert.equal(groupUpdates[0].record.bvslLeader, 'parent-rgf');
  assert.equal(groupUpdates[0].record.bvslId, 'PARENT-RGF');
  assert.equal(groupUpdates[0].record.bvslName, 'Punya');
});

test('saving unchanged per-group roles clears a stale RGSF flag', async (t) => {
  const person = {
    id: 'richa-doc',
    userId: 'USER-216',
    email: 'richa-role@example.test',
    fullName: 'Richa Dewan',
    role: 'User',
    segment: 'PW',
    isBvFacilitator: true,
    isBvsl: true,
    isBvSubFacilitator: true,
    bvGroupId: 'temple-doc',
  };
  const temple = {
    id: 'temple-doc',
    groupId: 'temple-doc',
    groupName: 'Temple REnamed',
    segment: 'PW',
    bvslLeader: 'other-doc',
    bvslId: 'USER-OTHER',
    bvslName: 'Other Leader',
  };
  const nityananda = {
    id: 'nityananda-new',
    groupId: 'nityananda-new',
    groupName: 'Nityananda new',
    segment: 'PW',
    bvslLeader: 'richa-doc',
    bvslId: 'USER-216',
    bvslName: 'Richa Dewan',
    subFacilitatorId: 'geetha-doc',
    rgsfId: 'USER-231',
    subFacilitator: 'Geetha',
  };
  const updates = mockDirectory(t, [person, parent]);
  const groupUpdates: Array<{ id: string; record: any }> = [];
  t.mock.method(BvGroups, 'findAll', async () => ({ records: [temple, nityananda], hasMore: false }));
  t.mock.method(BvGroups, 'update', async (change: { id: string; record: any }) => {
    groupUpdates.push(change);
    return change;
  });

  const result = await assignBvRole.execute({
    input: {
      userId: 'USER-216',
      role: 'FACILITATOR',
      parentId: 'USER-001',
      multiRoles: { isFacilitator: true, isSubFacilitator: false },
    },
    context: superAdmin,
  } as never);

  assert.equal(result.success, true);
  assert.equal(groupUpdates.length, 0);
  assert.equal(updates[0].record.isBvFacilitator, true);
  assert.equal(updates[0].record.isBvsl, true);
  assert.equal(updates[0].record.isBvSubFacilitator, false);
});
