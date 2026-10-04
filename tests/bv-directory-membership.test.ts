import assert from 'node:assert/strict';
import test from 'node:test';
import { isBhaktiVrikshaDirectoryMember } from '../src/lib/bvDirectoryMembership';

test('an approved PW account is not a Bhakti Vriksha member until the form is approved', () => {
  assert.equal(isBhaktiVrikshaDirectoryMember({
    isBvMember: false,
    bvRegistrationStatus: null,
    bvGroupId: null,
  }), false);
  assert.equal(isBhaktiVrikshaDirectoryMember({
    bvRegistrationStatus: 'Pending Approval',
  }), false);
  assert.equal(isBhaktiVrikshaDirectoryMember({
    bvRegistrationStatus: 'Rejected',
  }), false);
});

test('approved members, group placements, and assigned roles stay in the Bhakti Vriksha columns', () => {
  assert.equal(isBhaktiVrikshaDirectoryMember({ isBvMember: true }), true);
  assert.equal(isBhaktiVrikshaDirectoryMember({
    isBvMember: false,
    bvRegistrationStatus: 'Approved',
  }), true);
  assert.equal(isBhaktiVrikshaDirectoryMember({ bvGroupId: 'group-1' }), true);
  assert.equal(isBhaktiVrikshaDirectoryMember({ isBvFacilitator: true }), true);
  assert.equal(isBhaktiVrikshaDirectoryMember({ isBvSubFacilitator: true }), true);
});
