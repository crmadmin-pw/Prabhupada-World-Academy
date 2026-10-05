import assert from 'node:assert/strict';
import test from 'node:test';
import { mentorReportLocation, mentorReportLocations } from '../src/lib/mentorReportLocation';

const residencies = [{ residencyId: 'powai-doc', residencyName: 'FOLK Powai' }];
const rows = [
  { residencyId: 'powai-doc', residencyName: 'FOLK Powai' },
  { residencyId: 'OLD-POWAI', residencyName: 'Powai' },
  { residencyId: 'vashi-doc', residencyName: 'FOLK Vashi' },
  { residencyId: null, residencyName: null },
];
test('mentor choices include guide-linked Vashi and assigned Powai, deduplicating aliases', () => {
  assert.deepEqual(mentorReportLocations(rows, residencies), [
    { value: 'powai', label: 'Powai' }, { value: 'vashi', label: 'Vashi' },
  ]);
  assert.equal(rows.filter(row => mentorReportLocation(row, residencies).value === 'powai').length, 2);
  assert.equal(rows.filter(row => mentorReportLocation(row, residencies).value === 'vashi').length, 1);
});
test('location choices do not expose locations without authorized report rows', () => {
  assert.deepEqual(mentorReportLocations([], residencies), []);
  assert.deepEqual(mentorReportLocations([rows[2]], residencies), [{ value: 'vashi', label: 'Vashi' }]);
});
test('missing names use authorized reference labels and unknown IDs stay distinguishable', () => {
  assert.equal(mentorReportLocation({ residencyId: 'POWAI-DOC' }, residencies).value, 'powai');
  assert.equal(mentorReportLocation({ residencyId: 'unknown' }, residencies).value, 'unknown');
});
