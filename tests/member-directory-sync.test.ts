import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeApprovedDirectoryMembers, noteApprovedDirectoryMember } from '../src/lib/memberDirectorySync';

test('an approved member stays in the directory until the server list includes them', () => {
  noteApprovedDirectoryMember({
    userId: 'doc-1',
    fullName: 'New Devotee',
    segment: 'PW',
    isPrabhupadaWorldUser: true,
    status: 'ACTIVE',
  });

  const stale = mergeApprovedDirectoryMembers(
    [{ userId: 'existing', fullName: 'Existing' }],
    member => ({ userId: member.userId, fullName: member.fullName }),
  );
  assert.deepEqual(stale.map(user => user.fullName), ['New Devotee', 'Existing']);

  const fresh = mergeApprovedDirectoryMembers(
    [{ userId: 'doc-1', fullName: 'New Devotee' }, { userId: 'existing', fullName: 'Existing' }],
    member => ({ userId: member.userId, fullName: member.fullName }),
  );
  assert.deepEqual(fresh.map(user => user.fullName), ['New Devotee', 'Existing']);
  assert.equal(fresh.filter(user => user.userId === 'doc-1').length, 1);
});
