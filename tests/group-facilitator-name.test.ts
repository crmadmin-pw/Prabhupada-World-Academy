import assert from 'node:assert/strict';
import test from 'node:test';
import { facilitatorDisplayName, indexFacilitatorUsers } from '../src/api/getAllBvGroupsAdmin';

test('approval shows the RGF stored by public user id, not only document id', () => {
  const asha = { id: 'asha-doc', userId: 'ASHA-1', email: 'asha@example.invalid', fullName: 'Asha' };
  const users = indexFacilitatorUsers([asha]);
  const name = facilitatorDisplayName({
    groupName: 'Gauranga 1:30',
    bvslId: 'ASHA-1',
  }, users);
  assert.equal(name, 'Asha');
});

test('approval keeps the name saved on the group when the user record is missing', () => {
  const name = facilitatorDisplayName({
    bvslId: 'missing-rgf',
    bvslName: 'Asha',
  }, new Map());
  assert.equal(name, 'Asha');
});
