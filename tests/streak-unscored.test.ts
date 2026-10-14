import assert from 'node:assert/strict';
import test from 'node:test';
import { computeStreak } from '../src/lib/streakUtils';

test('a submitted day with no target counts toward the streak', () => {
  assert.equal(computeStreak([{ entryDate: '2026-10-14', scorePercent: null }], '2026-10-14'), 1);
  assert.equal(computeStreak([{ entryDate: '2026-10-14', scorePercent: 0, maxScore: 0 }], '2026-10-14'), 1);
  assert.equal(computeStreak([{ entryDate: '2026-10-14', scorePercent: 0, maxScore: 100 }], '2026-10-14'), 0);
  assert.equal(computeStreak([{ entryDate: '2026-10-14', scorePercent: 80, maxScore: 100 }], '2026-10-14'), 1);
});
