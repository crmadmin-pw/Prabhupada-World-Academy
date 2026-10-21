import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReportAttendance } from '../src/lib/bvReportAttendance';

test('a moved member stays absent on days the new group met', () => {
  const memberGroup = new Map([['rimpy-doc', 'tempos-doc']]);
  const merged = mergeReportAttendance([
    { user: 'rimpy-doc', group: 'old-doc', attendanceDate: '2026-10-14', present: true },
    { user: 'rimpy-doc', group: 'old-doc', attendanceDate: '2026-10-16', present: true },
    { user: 'rimpy-doc', group: 'old-doc', attendanceDate: '2026-10-17', present: true },
    { user: 'rimpy-doc', group: 'tempos-doc', attendanceDate: '2026-10-16', present: false },
    { user: 'rimpy-doc', group: 'tempos-doc', attendanceDate: '2026-10-17', present: false },
    { user: 'other-doc', group: 'tempos-doc', attendanceDate: '2026-10-16', present: true },
    { user: 'other-doc', group: 'tempos-doc', attendanceDate: '2026-10-17', present: true },
  ], memberGroup, reference => reference, reference => reference);

  assert.equal(merged.attendance['rimpy-doc']['2026-10-14'], true);
  assert.equal(merged.attendance['rimpy-doc']['2026-10-16'], false);
  assert.equal(merged.attendance['rimpy-doc']['2026-10-17'], false);
  assert.equal(merged.groupSessionDates.get('tempos-doc')?.has('2026-10-16'), true);
});

test('an unmarked day in the new group is not filled from the previous group', () => {
  const memberGroup = new Map([['rimpy-doc', 'tempos-doc']]);
  const merged = mergeReportAttendance([
    { user: 'rimpy-doc', group: 'old-doc', attendanceDate: '2026-10-17', present: true },
    { user: 'other-doc', group: 'tempos-doc', attendanceDate: '2026-10-17', present: true },
  ], memberGroup, reference => reference, reference => reference);

  assert.equal(merged.attendance['rimpy-doc']?.['2026-10-17'], undefined);
});
