import assert from 'node:assert/strict';
import test from 'node:test';
import { runningTimeSlotsFromGroups } from '../src/lib/bvRunningTimeSlots';

test('the join form lists only active group times for that department', () => {
  const slots = runningTimeSlotsFromGroups([
    { segment: 'PW', isActive: true, meetingTime: '7:45 PM – 8:15 PM (Everyday)' },
    { segment: 'PW', isActive: true, meetingTime: '7:45 PM - 8:15 PM (Everyday)' },
    { segment: 'PW', isActive: false, meetingTime: '6:00 AM – 6:30 AM (Everyday)' },
    { segment: 'FOLK', isActive: true, meetingTime: '1:00 PM – 1:30 PM (Monday to Friday)' },
    { segment: 'PW', isActive: true, meetingTime: '   ' },
    { segment: 'PW', isActive: true, preferredTimeSlot: '11:00 AM – 12:00 PM (Saturday & Sunday)' },
    { isActive: true, meetingTime: '8:30 PM – 9:00 PM (Monday to Friday)' },
  ], 'PW');

  assert.deepEqual(slots, [
    '11:00 AM – 12:00 PM (Saturday & Sunday)',
    '7:45 PM – 8:15 PM (Everyday)',
    '8:30 PM – 9:00 PM (Monday to Friday)',
  ]);
});

test('a newly created group time appears for its department', () => {
  const created = '6:00 PM – 7:00 PM (Monday, Wednesday)';
  const slots = runningTimeSlotsFromGroups([
    { segment: 'FOLK', isActive: true, meetingTime: '1:00 PM – 1:30 PM (Monday to Friday)' },
    { segment: 'FOLK', isActive: true, meetingTime: created },
  ], 'FOLK');

  assert.deepEqual(slots, [
    '1:00 PM – 1:30 PM (Monday to Friday)',
    created,
  ]);
});
