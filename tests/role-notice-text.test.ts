import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoleNotice } from '../src/lib/roleNoticeText';

test('a combined role notice keeps the assigned role separate from the removed role', () => {
  assert.deepEqual(parseRoleNotice('Assigned role: RGSF | Removed role: RGF'), {
    assigned: ['RGSF'],
    removed: ['RGF'],
  });
});

test('older responsibility wording and several names still parse', () => {
  assert.deepEqual(parseRoleNotice('Assigned responsibility: BV Supervisor, RGF'), {
    assigned: ['BV Supervisor', 'RGF'],
    removed: [],
  });
  assert.deepEqual(parseRoleNotice('Removed role: RGSF'), {
    assigned: [],
    removed: ['RGSF'],
  });
});
