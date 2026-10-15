import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPwProgress, pwFieldPercent, pwScoreFromFieldValues, pwSnapshotMeta, scorePwSadhana, scorePwSadhanaV2 } from '../src/lib/pwSadhana';

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

test('a saved day uses the target from that day', () => {
  const scored = pwScoreFromFieldValues(JSON.stringify({
    chanting: 4,
    reading: 30,
    _meta: { pwChantingTarget: 8, pwReadingTarget: 30 },
  }));
  assert.equal(scored.scorePercent, 75);
  assert.equal(pwScoreFromFieldValues(JSON.stringify({ chanting: 4, reading: 10 })).scorePercent, null);
});

test('an unassigned member has no percentage and keeps the filled number', () => {
  const scored = scorePwSadhana({ chanting: 3, reading: 10, chantingTarget: null, readingTarget: null });
  assert.equal(scored.scorePercent, null);
  assert.equal(pwFieldPercent(3, null), null);
  assert.equal(formatPwProgress(3, null), '3');
});

const fullTargets = {
  wakeUp: '04:30',
  sleep: '22:30',
  chanting: 8,
  readingMin: 40,
  hearingMin: 30,
  sevaMin: 60,
};

test('a complete day scores 60 points and 100 percent', () => {
  const scored = scorePwSadhanaV2({
    wakeUp: '04:30',
    sleep: '22:00',
    chanting: 8,
    reading: 40,
    hearing: 30,
    seva: 60,
    bvAttendedMinutes: 20,
    bvSessionMinutes: 30,
    submittedAt: '2026-10-15T04:00:00.000Z',
    entryDate: '2026-10-15',
    submissionDeadline: '10:00',
    targets: fullTargets,
  });
  assert.equal(scored.earned, 60);
  assert.equal(scored.applicableMax, 60);
  assert.equal(scored.scorePercent, 100);
});

test('time, band, chanting, and attendance boundaries match the rubric', () => {
  const scored = scorePwSadhanaV2({
    wakeUp: '05:30',
    sleep: '00:30',
    chanting: 4,
    reading: 10,
    hearing: 23,
    seva: 46,
    bvAttendedMinutes: 15,
    bvSessionMinutes: 30,
    submittedAt: '2026-10-15T06:30:00.000Z',
    entryDate: '2026-10-15',
    submissionDeadline: '10:00',
    targets: fullTargets,
  });
  const points = Object.fromEntries(scored.fields.map(field => [field.key, field.points]));
  assert.equal(points.wakeUp, 2);
  assert.equal(points.sleep, 0);
  assert.equal(points.chanting, 8);
  assert.equal(points.reading, 2);
  assert.equal(points.hearing, 6);
  assert.equal(points.seva, 6);
  assert.equal(points.bvAttendance, 5);
  assert.equal(points.submitted, 1);
});

test('a waive-off with a reason scores full points and a missing target is left out', () => {
  const scored = scorePwSadhanaV2({
    wakeUp: '09:00',
    chanting: 0,
    reading: 0,
    waiveChanting: true,
    waiveChantingReason: 'Travel',
    submittedAt: '2026-10-15T03:00:00.000Z',
    entryDate: '2026-10-15',
    targets: { ...fullTargets, wakeUp: '04:30', sleep: null, hearingMin: null, sevaMin: null },
  });
  const points = Object.fromEntries(scored.fields.map(field => [field.key, field.points]));
  assert.equal(points.chanting, 16);
  assert.equal(points.wakeUp, 0);
  assert.equal(points.sleep, null);
  assert.equal(points.hearing, null);
  assert.equal(points.seva, null);
  assert.equal(points.bvAttendance, null);
  assert.equal(points.submitted, 2);
  assert.equal(scored.applicableMax, 4 + 16 + 8 + 2);
  assert.equal(scored.scorePercent, Math.round((18 / 30) * 100));
});

test('a saved 60-point day is read back from its snapshot', () => {
  const scored = scorePwSadhanaV2({
    wakeUp: '04:30', sleep: '22:30', chanting: 8, reading: 40, hearing: 30, seva: 60,
    bvAttendedMinutes: 20, bvSessionMinutes: 30,
    submittedAt: '2026-10-15T04:00:00.000Z', entryDate: '2026-10-15', targets: fullTargets,
  });
  const stored = pwScoreFromFieldValues({
    chanting: 8,
    reading: 40,
    _meta: pwSnapshotMeta({ result: scored, targets: fullTargets, source: 'rgf', deadline: '10:00' }),
  });
  assert.equal(stored.version, 2);
  assert.equal(stored.scorePercent, 100);
  assert.equal(stored.fieldPoints?.bvAttendance, 10);
});
