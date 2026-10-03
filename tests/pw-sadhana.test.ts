import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPwProgress, pwFieldPercent, scorePwSadhana } from '../src/lib/pwSadhana';

test('chanting and reading cap at 100 percent when the member exceeds the assignment', () => {
  const scored = scorePwSadhana({ chanting: 12, reading: 45, chantingTarget: 8, readingTarget: 30 });
  assert.equal(scored.chantingPercent, 100);
  assert.equal(scored.readingPercent, 100);
  assert.equal(scored.scorePercent, 100);
  assert.equal(formatPwProgress(12, 8), '12/8');
});

test('a partial day is the share of each assigned target', () => {
  const scored = scorePwSadhana({ chanting: 4, reading: 15, chantingTarget: 8, readingTarget: 30 });
  assert.equal(scored.chantingPercent, 50);
  assert.equal(scored.readingPercent, 50);
  assert.equal(scored.scorePercent, 50);
  assert.equal(formatPwProgress(4, 8), '4/8');
});

test('an unassigned member has no percentage and keeps the filled number', () => {
  const scored = scorePwSadhana({ chanting: 3, reading: 10, chantingTarget: null, readingTarget: null });
  assert.equal(scored.scorePercent, null);
  assert.equal(pwFieldPercent(3, null), null);
  assert.equal(formatPwProgress(3, null), '3');
});
