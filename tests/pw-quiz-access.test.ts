import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canTurnPwQuizOnForGroup,
  isPwQuizContentManager,
  isPwQuizFacilitator,
  pwQuizEnabledForGroup,
  quizUserDepartment,
  withGroupActivation,
} from '../src/lib/bvQuizAccess';

const active = { isActive: true, status: 'ACTIVE' };

test('Prabhupada World admins can author quizzes and facilitators cannot', () => {
  assert.equal(isPwQuizContentManager({ ...active, segment: 'PW', role: 'ADMIN', isBvAdmin: true }), true);
  assert.equal(isPwQuizContentManager({ ...active, segment: 'PW', role: 'SUPER_ADMIN', isBvSuperAdmin: true }), true);
  assert.equal(isPwQuizContentManager({ ...active, segment: 'PW', role: 'PW_ADMIN' }), true);
  assert.equal(isPwQuizContentManager({ ...active, segment: 'FOLK', role: 'ADMIN', isBvAdmin: true }), false);
  assert.equal(isPwQuizContentManager({ ...active, segment: 'PW', role: 'USER', isBvFacilitator: true }), false);
  assert.equal(isPwQuizFacilitator({ ...active, segment: 'PW', role: 'USER', isBvFacilitator: true }), true);
  assert.equal(isPwQuizFacilitator({ ...active, segment: 'PW', role: 'RGSF', isBvSubFacilitator: true }), false);
  assert.equal(isPwQuizFacilitator({ ...active, segment: 'FOLK', role: 'USER', isBvFacilitator: true }), false);
  assert.equal(canTurnPwQuizOnForGroup({ ...active, segment: 'PW', role: 'USER', isBvFacilitator: true }), true);
  assert.equal(canTurnPwQuizOnForGroup({ ...active, segment: 'PW', role: 'ADMIN', isBvAdmin: true }), false);
  assert.equal(canTurnPwQuizOnForGroup({ ...active, segment: 'PW', role: 'SUPER_ADMIN', isBvSuperAdmin: true, isBvFacilitator: true }), false);
});

test('a quiz stays hidden until the facilitator turns that group on', () => {
  const group = { id: 'group-doc', groupId: 'BV-1', groupName: 'Mayapur' };
  const quiz = { isActive: true, activeGroupIds: [] as string[] };
  assert.equal(pwQuizEnabledForGroup(quiz, group), false);
  const turnedOn = withGroupActivation(quiz.activeGroupIds, group, true);
  assert.deepEqual(turnedOn, ['group-doc']);
  assert.equal(pwQuizEnabledForGroup({ ...quiz, activeGroupIds: turnedOn }, group), true);
  assert.equal(pwQuizEnabledForGroup({ ...quiz, isActive: false, activeGroupIds: turnedOn }, group), false);
  assert.deepEqual(withGroupActivation(turnedOn, group, false), []);
  assert.equal(quizUserDepartment({ segment: 'Prabhupada World' }), 'PW');
  assert.equal(quizUserDepartment({ segment: 'FOLK', role: 'ADMIN' }), 'FOLK');
});
