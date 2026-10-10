import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryReads } from '../src/lib/realtimeChannels';
import { directoryPatchEchoed, mergePendingDirectoryPatches, mergePendingMentors } from '../src/lib/pendingDirectoryPatch';

test('assigning a Bhakti Vriksha role refreshes the member directory cache', () => {
  assert.deepEqual(directoryReads('assignBvRole'), ['getGuideUsers']);
  assert.ok(directoryReads('tagUserAsSadhanaMentor').includes('getGuideUsers'));
  assert.ok(directoryReads('tagUserAsSadhanaMentor').includes('getActiveSadhanaMentors'));
  assert.deepEqual(directoryReads('submitSadhana'), []);
});

test('a stale directory response keeps a role that was just assigned', () => {
  const pending = new Map([['member-1', {
    isBvFacilitator: true,
    isBvsl: true,
    bvReportingSupervisorId: 'supervisor-1',
  }]]);
  const stale = mergePendingDirectoryPatches(
    [{ userId: 'member-1', fullName: 'Member One', isBvFacilitator: false, isBvsl: false }],
    pending,
    row => [String(row.userId)],
  );
  assert.equal(stale[0].isBvFacilitator, true);
  assert.equal(stale[0].bvReportingSupervisorId, 'supervisor-1');

  const fresh = mergePendingDirectoryPatches(
    [{ userId: 'member-1', isBvFacilitator: true, isBvsl: true, bvReportingSupervisorId: 'supervisor-1', fullName: 'Member One' }],
    pending,
    row => [String(row.userId)],
  );
  assert.equal(fresh[0].fullName, 'Member One');
  assert.equal(directoryPatchEchoed(fresh[0], pending.get('member-1')!), true);
});

test('a newly tagged mentor stays in the dropdown when the mentor list is stale', () => {
  const pending = new Map([['mentor-1', { userId: 'mentor-1', fullName: 'New Mentor', tagged: true }]]);
  const merged = mergePendingMentors([], pending);
  assert.deepEqual(merged, [{ userId: 'mentor-1', fullName: 'New Mentor', email: '' }]);
  const echoed = mergePendingMentors([{ userId: 'mentor-1', fullName: 'New Mentor' }], pending);
  assert.equal(echoed.length, 1);
});
