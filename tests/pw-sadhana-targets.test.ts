import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
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

test('an unmarked member stored by sign-in id can receive a target from their reading group', async t => {
  const member = {
    id: 'asha-doc', userId: 'USER-ASHA', email: 'asha@example.test', fullName: 'Asha N',
    role: 'User', status: 'Active', firebaseUid: 'asha-auth', segment: '',
  };
  const rgfCaller = { ...rgf, id: 'ramya-doc', userId: 'USER-RAMYA', email: 'ramya@example.test', firebaseUid: 'ramya-auth' };
  const fixtures: Record<string, any[]> = {
    Users: [rgfCaller, member],
    BvGroups: [{ id: 'gauranga-doc', groupId: 'GAURANGA-130', groupName: 'Gauranga 1:30', isActive: true, bvslLeader: rgfCaller.id, bvslId: rgfCaller.userId }],
    BvGroupMembers: [{ id: 'asha-membership', group: 'gauranga-doc', memberId: 'asha-auth', user: 'asha-auth' }],
  };
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.map(String).includes(String(item)));
      return true;
    }
    return [actual].flat().map(String).includes(String(value));
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => {
      let records = (fixtures[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      const page = records.slice(options.offset || 0, (options.offset || 0) + (options.limit || 2000));
      return {
        records: page.map(record => options.fields ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, record[key]])) : { ...record }),
        hasMore: false,
      };
    };
    t.mock.method(table, 'findAll', async (options: any) => query(options));
    t.mock.method(table, 'findOne', async (options: any) => query(options).records[0]);
  }
  const updates: any[] = [];
  t.mock.method(Users, 'update', async (value: any) => { updates.push(value); return value; });

  const result = await setPwSadhanaTargets.execute({
    input: { userId: member.userId, chantingRounds: 16, readingMinutes: 60 },
    context: { user: rgfCaller },
  } as never);
  assert.equal(result.pwChantingTarget, 16);
  assert.equal(result.pwReadingTarget, 60);
  assert.equal(updates[0].id, member.id);
  assert.equal(updates[0].record.segment, 'PW');
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
