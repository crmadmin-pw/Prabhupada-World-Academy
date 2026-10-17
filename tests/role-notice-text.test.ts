import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgementPopup, noticeForRoleUpdate, parseRoleNotice } from '../src/lib/roleNoticeText';

test('a combined role notice keeps the assigned role separate from the removed role', () => {
  assert.deepEqual(parseRoleNotice('Assigned role: RGSF | Removed role: RGF'), {
    assigned: ['RGSF'],
    removed: ['RGF'],
    reportsTo: null,
  });
});

test('older responsibility wording and several names still parse', () => {
  assert.deepEqual(parseRoleNotice('Assigned responsibility: BV Supervisor, RGF'), {
    assigned: ['BV Supervisor', 'RGF'],
    removed: [],
    reportsTo: null,
  });
  assert.deepEqual(parseRoleNotice('Removed role: RGSF'), {
    assigned: [],
    removed: ['RGSF'],
    reportsTo: null,
  });
});

test('acknowledgement notices keep their existing priority', () => {
  assert.equal(acknowledgementPopup(null), null);
  assert.equal(acknowledgementPopup({
    pendingBvApprovalNotice: true,
    pendingBvRejectionNotice: true,
  }), 'bv_approval_notice');
  assert.equal(acknowledgementPopup({
    pendingBvGroupAssignmentNotice: true,
    roleNoticeAcknowledged: true,
    pendingRoleNotice: 'Assigned role: RGF',
  }), null);
  assert.equal(acknowledgementPopup({
    pendingAshrayNoticeStatus: 'rejected',
  }), 'ashray_notice_rejected');
});

test('changing only the reporting parent names that person', () => {
  assert.equal(noticeForRoleUpdate({
    added: [],
    removed: [],
    previousParent: 'Vedanarayana Das',
    nextParent: 'BITS VEDANG',
  }), 'Now reports to: BITS VEDANG');
  assert.equal(parseRoleNotice('Now reports to: BITS VEDANG').reportsTo, 'BITS VEDANG');
  assert.equal(noticeForRoleUpdate({
    added: [],
    removed: [],
    previousParent: 'BITS VEDANG',
    nextParent: 'BITS VEDANG',
  }), null);
});
