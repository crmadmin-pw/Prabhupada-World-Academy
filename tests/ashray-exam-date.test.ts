import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAshrayExamDate } from '../src/api/ashrayExamDate';

test('Ashraya exam dates normalize both admin input formats', () => {
  assert.equal(normalizeAshrayExamDate('2027-04-10'), '4/10/2027');
  assert.equal(normalizeAshrayExamDate('4/10/2027'), '4/10/2027');
  assert.equal(normalizeAshrayExamDate(''), '');
});

test('invalid Ashraya exam dates are rejected', () => {
  assert.throws(() => normalizeAshrayExamDate('2027-02-30'), /valid exam date/);
  assert.throws(() => normalizeAshrayExamDate('not-a-date'), /valid exam date/);
});
