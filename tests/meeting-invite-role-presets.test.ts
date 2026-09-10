import assert from 'node:assert/strict';
import test from 'node:test';
import { hasMeetingInviteeIdentity, hasMeetingRole, meetingInviteeLabel } from '../src/components/super/MeetingsAndMomTab';

test('invite role presets use assigned roles when multi-role data exists', () => {
  const user = { roles: ['MEMBER', 'RGF'], isBvSubFacilitator: true };
  assert.equal(hasMeetingRole(user, 'RGF'), true);
  assert.equal(hasMeetingRole(user, 'FACILITATOR'), true);
  assert.equal(hasMeetingRole(user, 'RGSF'), true);
  assert.equal(hasMeetingRole(user, 'SUPERVISOR'), false);
});

test('invite role presets support every assigned role category', () => {
  const users = [
    [{ roles: ['ADMIN'] }, 'ADMIN'],
    [{ roles: ['SUPERVISOR'] }, 'SUPERVISOR'],
    [{ roles: ['SADHANA_MENTOR'] }, 'MENTOR'],
    [{ roles: ['FACILITATOR'] }, 'FACILITATOR'],
    [{ roles: ['FACILITATOR'] }, 'RGF'],
    [{ roles: ['RGF'] }, 'RGF'],
    [{ roles: ['RGSF'] }, 'RGSF'],
  ] as const;
  for (const [user, role] of users) assert.equal(hasMeetingRole(user, role), true);
});

test('role flags remain supported when a multi-role record also has a base role', () => {
  assert.equal(hasMeetingRole({ isBvFacilitator: true }, 'RGF'), true);
  assert.equal(hasMeetingRole({ roles: ['MEMBER'], isBvFacilitator: true }, 'RGF'), true);
  assert.equal(hasMeetingRole({ roles: ['USER'], isBvSubFacilitator: true }, 'RGSF'), true);
});

test('PW users with a User base role remain visible when assigned as an RGF', () => {
  const user = {
    fullName: 'Test RGF',
    role: 'User',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    isBvsl: true,
    isBvFacilitator: true,
  };

  assert.equal(hasMeetingRole(user, 'RGF'), true);
  assert.equal(hasMeetingRole(user, 'FACILITATOR'), true);
});

test('multi-role values are all matched, including legacy serialized values', () => {
  const user = { role: 'USER', roles: '["USER", "RGF"]', isBvSubFacilitator: true };
  assert.equal(hasMeetingRole(user, 'RGF'), true);
  assert.equal(hasMeetingRole(user, 'RGSF'), true);
});

test('meeting invitees exclude role-only records that have no visible identity', () => {
  assert.equal(hasMeetingInviteeIdentity({ roles: ['ADMIN'] }), false);
  assert.equal(hasMeetingInviteeIdentity({ fullName: '   ', email: '  ', roles: ['RGF'] }), false);
  assert.equal(hasMeetingInviteeIdentity({ fullName: 'Hiranyavarna Das', roles: ['ADMIN'] }), true);
  assert.equal(hasMeetingInviteeIdentity({ email: 'facilitator@example.test', roles: ['RGF'] }), true);
  assert.equal(hasMeetingInviteeIdentity({ fullName: '\u200B\uFEFF', roles: ['RGF'] }), false);
  assert.equal(meetingInviteeLabel({ displayName: 'Legacy RGF' }), 'Legacy RGF');
  assert.equal(meetingInviteeLabel({ name: 'Named RGF' }), 'Named RGF');
});
