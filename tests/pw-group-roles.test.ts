import assert from 'node:assert/strict';
import test from 'node:test';
import { pwReadingGroups } from '../src/lib/pwGroupRoles';

const user = { id: 'pw-user', userId: 'PW-USER', fullName: 'Pw User', email: 'pw@example.test' };

test('a PW user keeps a different role in each reading group', () => {
  const groups = pwReadingGroups(user, [
    { id: 'morning', groupId: 'morning', groupName: 'Morning', rgfIds: ['pw-user', 'PW-USER'], rgsfIds: [] },
    { id: 'evening', groupId: 'evening', groupName: 'Evening', rgfIds: ['other'], rgsfIds: ['PW-USER'] },
    { id: 'other', groupId: 'other', groupName: 'Other', rgfIds: ['someone'], rgsfIds: [] },
  ]);

  assert.deepEqual(groups.map(group => [group.groupName, group.role]), [
    ['Morning', 'FACILITATOR'],
    ['Evening', 'SUB_FACILITATOR'],
  ]);
});
