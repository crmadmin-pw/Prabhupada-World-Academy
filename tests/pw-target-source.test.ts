import assert from 'node:assert/strict';
import test from 'node:test';
import { canSetPwTargets, pwTargetSource } from '../src/lib/pwTargetResolver';

const rgf = { id: 'rgf', isBvFacilitator: true };
const admin = { id: 'admin', isBvAdmin: true };
const mentor = { id: 'mentor', userId: 'MENTOR-1', isSadhanaMentor: true };
const supervisor = { id: 'sup', isBvSupervisor: true };

test('targets come from the RGF, the admin, the mentor, then the Ashraya level', () => {
  assert.equal(pwTargetSource({ isBvMember: true }), 'rgf');
  assert.equal(pwTargetSource({ isBvSubFacilitator: true }), 'rgf');
  assert.equal(pwTargetSource({ id: 'plain' }, true), 'rgf');
  assert.equal(pwTargetSource({ isBvFacilitator: true, isBvMember: true }), 'admin');
  assert.equal(pwTargetSource(supervisor), 'admin');
  assert.equal(pwTargetSource({ sadhanaMentor: 'MENTOR-1' }), 'mentor');
  assert.equal(pwTargetSource({ ashrayLevel: 'Sevak' }), 'ashraya');
});

test('only the matching authority can save those targets', () => {
  const bvMember = { id: 'member', isBvMember: true };
  const mentee = { id: 'mentee', sadhanaMentor: mentor.userId };
  assert.equal(canSetPwTargets(rgf, bvMember).allowed, true);
  assert.equal(canSetPwTargets(mentor, bvMember).allowed, false);
  assert.equal(canSetPwTargets(admin, supervisor).allowed, true);
  assert.equal(canSetPwTargets(rgf, supervisor).allowed, false);
  assert.equal(canSetPwTargets(mentor, mentee).allowed, true);
  assert.equal(canSetPwTargets(admin, mentee).allowed, false);
  assert.equal(canSetPwTargets(rgf, { id: 'ashraya' }).allowed, false);
  assert.equal(canSetPwTargets(rgf, { id: 'grouped' }, true).source, 'rgf');
});
