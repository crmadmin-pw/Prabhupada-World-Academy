import test from 'node:test';
import assert from 'node:assert/strict';
import { rgsfAssignmentOptions } from '../src/lib/rgsfAssignmentOptions';

test('one RGF has a distinct choice for each active reading group they facilitate', () => {
  const people = [{ id: 'rgf-db', name: 'Asha N', rawUser: { userId: 'RGF-ASHA' } }];
  const options = rgsfAssignmentOptions(people, [
    { id: 'gada', groupName: 'Gadadhara', rgfIds: ['RGF-ASHA'] },
    { id: 'krishna', groupName: 'Krishna', rgfIds: ['rgf-db'] },
    { id: 'other', groupName: 'Other', rgfIds: ['someone-else'], rgsfIds: ['rgf-db'] },
    { id: 'closed', groupName: 'Closed', rgfIds: ['rgf-db'], isActive: false },
  ]);
  assert.deepEqual(options.map(option => option.label), ['Asha N — Gadadhara', 'Asha N — Krishna']);
  assert.notEqual(options[0].key, options[1].key);
  assert.deepEqual(options.map(option => option.groupId), ['gada', 'krishna']);
});

test('co-facilitators appear as separate RGF/group pairs', () => {
  const options = rgsfAssignmentOptions([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], [{ id: 'g', groupName: 'Reading Group', rgfIds: ['a', 'b'] }]);
  assert.deepEqual(options.map(option => option.label), ['A — Reading Group', 'B — Reading Group']);
});
