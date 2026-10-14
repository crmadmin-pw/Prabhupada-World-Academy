import assert from 'node:assert/strict';
import test from 'node:test';

import conductBvSession from '../src/api/conductBvSession';
import markBvAttendance from '../src/api/markBvAttendance';
import { BvAttendance, BvGroupMembers, BvGroups, BvSessions, Users } from '../src/lib/app-backend-sdk';
import { getTodayIST } from '../src/lib/streakUtils';

const punya = {
  id: 'PUNYA-DOC',
  userId: 'PUNYA',
  email: 'punya@example.invalid',
  fullName: 'Punya',
  firebaseUid: 'PUNYA-FIREBASE',
  role: 'User',
  status: 'Active',
  isBvFacilitator: true,
  isBvsl: true,
};

const firstRgf = {
  id: 'FIRST-RGF-DOC',
  userId: 'FIRST-RGF',
  email: 'first-rgf@example.invalid',
  fullName: 'First RGF',
  role: 'User',
  status: 'Active',
  isBvFacilitator: true,
};

const member = {
  id: 'PW-MEMBER-DOC',
  userId: 'PW-MEMBER',
  email: 'pw-member@example.invalid',
  fullName: 'PW Member',
  role: 'User',
  status: 'Active',
};

const group = {
  id: 'PW-TWO-RGF-GROUP-DOC',
  groupId: 'PW-TWO-RGF-GROUP',
  groupName: 'Temple SF 1',
  segment: 'PW',
  isActive: true,
  bvslLeader: [firstRgf.id, punya.id],
  bvslId: [firstRgf.userId, punya.userId],
  bvslName: [firstRgf.fullName, punya.fullName],
};

test('every RGF on a reading group can update attendance', async () => {
  const today = getTodayIST();
  const created: Array<{ table: any; id: string }> = [];
  const track = (table: any, id: string) => created.push({ table, id });

  await Users.create({ record: punya });
  await Users.create({ record: firstRgf });
  await Users.create({ record: member });
  await BvGroups.create({ record: group });
  await BvGroupMembers.create({
    record: { id: 'PW-TWO-RGF-MEMBERSHIP', user: member.id, group: group.id },
  });
  track(Users, punya.id);
  track(Users, firstRgf.id);
  track(Users, member.id);
  track(BvGroups, group.id);
  track(BvGroupMembers, 'PW-TWO-RGF-MEMBERSHIP');

  try {
    const saved = await conductBvSession.execute({
      input: {
        bvslId: punya.userId,
        groupId: group.id,
        sessionDate: today,
        memberAttendance: [{ userDbId: member.id, present: true, attendedMinutes: 60 }],
      },
      context: {
        user: { id: punya.firebaseUid, uid: punya.firebaseUid, userId: punya.firebaseUid, email: punya.email },
      },
    } as never);
    assert.equal(saved.success, true);

    await markBvAttendance.execute({
      input: { userId: member.userId, status: 'A', localDate: today },
      context: { user: { id: punya.id, userId: punya.userId, email: punya.email, fullName: punya.fullName } },
    } as never);

    await assert.rejects(
      () => conductBvSession.execute({
        input: {
          bvslId: member.userId,
          groupId: group.id,
          sessionDate: today,
          presentUserIds: [member.id],
        },
        context: { user: { id: member.id, userId: member.userId, email: member.email } },
      } as never),
      (error: any) => error?.code === 'FORBIDDEN',
    );
  } finally {
    const { records: attendance } = await BvAttendance.findAll({
      filters: { group: group.id },
      fields: ['id'],
      limit: 20,
    });
    const { records: sessions } = await BvSessions.findAll({
      filters: { group: group.id },
      fields: ['id'],
      limit: 20,
    });
    for (const record of attendance) await BvAttendance.delete({ id: record.id }).catch(() => undefined);
    for (const record of sessions) await BvSessions.delete({ id: record.id }).catch(() => undefined);
    for (const item of created.reverse()) await item.table.delete({ id: item.id }).catch(() => undefined);
  }
});
