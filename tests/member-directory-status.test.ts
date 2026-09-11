import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveDirectoryMember } from '../src/lib/memberDirectoryStatus';

test('member directory keeps active members returned with either database or API status casing', () => {
  assert.equal(isActiveDirectoryMember('Active'), true);
  assert.equal(isActiveDirectoryMember('ACTIVE'), true);
  assert.equal(isActiveDirectoryMember(' active '), true);
  assert.equal(isActiveDirectoryMember('Pending Approval'), false);
  assert.equal(isActiveDirectoryMember('Inactive'), false);
});
