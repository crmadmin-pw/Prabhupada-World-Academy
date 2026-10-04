import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMeetingSchedule, meetingScheduleError } from '../src/lib/meetingSchedule';

test('a reading group schedule uses start, end, and the selected days', () => {
  assert.equal(
    formatMeetingSchedule('13:00', '13:30', ['fri', 'mon', 'tue', 'wed', 'thu']),
    '1:00 PM – 1:30 PM (Monday to Friday)',
  );
  assert.equal(
    formatMeetingSchedule('19:45', '20:15', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    '7:45 PM – 8:15 PM (Everyday)',
  );
  assert.equal(
    formatMeetingSchedule('11:00', '12:00', ['sun', 'sat']),
    '11:00 AM – 12:00 PM (Saturday & Sunday)',
  );
  assert.equal(
    formatMeetingSchedule('18:00', '19:00', ['wed', 'mon']),
    '6:00 PM – 7:00 PM (Monday, Wednesday)',
  );
  assert.ok(formatMeetingSchedule('00:00', '23:55', ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).length <= 100);
});

test('a schedule needs both times in order and at least one day', () => {
  assert.equal(meetingScheduleError('', '13:30', ['mon']), 'Please choose a start time and an end time');
  assert.equal(meetingScheduleError('13:30', '13:00', ['mon']), 'End time must be after the start time');
  assert.equal(meetingScheduleError('13:00', '13:30', []), 'Please select at least one day');
  assert.equal(meetingScheduleError('13:00', '13:30', ['mon']), null);
});
