import assert from 'node:assert/strict';
import test from 'node:test';
import { facilitatorDisplayName, indexFacilitatorUsers } from '../src/api/getAllBvGroupsAdmin';

test('approval shows the RGF stored by public user id, not only document id', () => {
  const asha = { id: 'asha-doc', userId: 'ASHA-1', email: 'asha@example.invalid', fullName: 'Asha' };
  const users = indexFacilitatorUsers([asha]);
  const name = facilitatorDisplayName({
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

test('a group with two RGFs shows both names', () => {
  const asha = { id: 'asha-doc', userId: 'ASHA-1', email: 'asha@example.invalid', fullName: 'Asha' };
  const ram = { id: 'ram-doc', userId: 'RAM-1', email: 'ram@example.invalid', fullName: 'Ram' };
  const users = indexFacilitatorUsers([asha, ram]);
  const name = facilitatorDisplayName({
    bvslLeader: ['asha-doc', 'ram-doc'],
    bvslId: ['ASHA-1', 'RAM-1'],
    bvslName: ['Asha', 'Ram'],
  }, users);
  assert.equal(name, 'Asha, Ram');
});
