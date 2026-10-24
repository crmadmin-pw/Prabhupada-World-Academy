import assert from 'node:assert/strict';
import test from 'node:test';
import { isPwSadhanaFormLocked, pwEntryDateBounds, pwSubmissionError, pwTimelySubmissionPoints, shiftSadhanaDate } from '../src/lib/pwSubmissionTiming';
import { scorePwSadhanaV2 } from '../src/lib/pwSadhana';

test('23 October submission windows include the exact opening and cutoff times in IST', () => {
  for (const [stamp, points] of [
    ['2026-10-23T17:59:59+05:30', 0], ['2026-10-23T18:00:00+05:30', 2],
    ['2026-10-23T23:59:59+05:30', 2], ['2026-10-24T00:00:00+05:30', 2],
    ['2026-10-24T10:00:00+05:30', 2], ['2026-10-24T10:00:00.001+05:30', 1],
    ['2026-10-24T14:00:00+05:30', 1], ['2026-10-24T14:00:00.001+05:30', 0],
    ['2026-10-25T08:00:00+05:30', 0],
  ] as const) assert.equal(pwTimelySubmissionPoints('2026-10-23', stamp), points, stamp);
  assert.match(pwSubmissionError('2026-10-23', new Date('2026-10-23T17:59:59+05:30'))!, /6:00 PM/);
  assert.equal(pwSubmissionError('2026-10-23', new Date('2026-10-23T18:00:00+05:30')), null);
  assert.equal(isPwSadhanaFormLocked('2026-10-23', new Date('2026-10-23T17:59:59+05:30')), true);
  assert.equal(isPwSadhanaFormLocked('2026-10-23', new Date('2026-10-23T18:00:00+05:30')), false);
  assert.equal(isPwSadhanaFormLocked('2026-10-22', new Date('2026-10-23T09:00:00+05:30')), false);
});

test('the previous seven days are allowed by IST calendar date even when UTC is still yesterday', () => {
  const now = new Date('2026-10-23T19:00:00Z');
  assert.deepEqual(pwEntryDateBounds(now), { min: '2026-10-17', max: '2026-10-24' });
  assert.equal(pwSubmissionError('2026-10-17', now), null);
  assert.match(pwSubmissionError('2026-10-16', now)!, /older than 7 days/);
  assert.match(pwSubmissionError('2026-10-25', now)!, /future/);
  assert.match(pwSubmissionError('2026-02-30', now)!, /Invalid/);
  assert.equal(shiftSadhanaDate('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftSadhanaDate('2026-10-23', -1), '2026-10-22');
});

test('late and backdated submissions keep sleep and every other field score', () => {
  const input = { entryDate: '2026-10-23', sleep: '22:00', wakeUp: '05:00', chanting: 8, reading: 30, targets: { sleep: '22:30', wakeUp: '05:00', chanting: 8, readingMin: 30, hearingMin: null, sevaMin: null } };
  const early = scorePwSadhanaV2({ ...input, submittedAt: '2026-10-23T18:00:00+05:30' });
  const nextMorning = scorePwSadhanaV2({ ...input, submittedAt: '2026-10-24T09:00:00+05:30' });
  const late = scorePwSadhanaV2({ ...input, submittedAt: '2026-10-30T09:00:00+05:30' });
  assert.deepEqual(early.fields, nextMorning.fields);
  assert.deepEqual(early.fields.filter(f => f.key !== 'submitted'), late.fields.filter(f => f.key !== 'submitted'));
  assert.equal(early.earned - late.earned, 2);
});
