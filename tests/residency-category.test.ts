import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isActiveFolkResidency,
  isPrabhupadaWorldCategory,
  isPrabhupadaWorldResidency,
  residencyMatchesDepartment,
} from '../src/lib/residencyCategory';

test('a FOLK residency stays visible when its name contains PW or Prabhupada World', () => {
  const folk = { residencyName: 'FOLK PW House', category: 'FOLK' };
  assert.equal(isPrabhupadaWorldResidency(folk), false);
  assert.equal(isActiveFolkResidency({ ...folk, isActive: true }), true);
  assert.equal(residencyMatchesDepartment({ residencyName: 'Prabhupada World Annex', category: 'FOLK' }, 'FOLK'), true);
});

test('lowercase and spaced category values count as Prabhupada World', () => {
  assert.equal(isPrabhupadaWorldCategory('pw'), true);
  assert.equal(isPrabhupadaWorldCategory('Prabhupada World'), true);
  assert.equal(isPrabhupadaWorldCategory('prabhupada-world'), true);
  assert.equal(isPrabhupadaWorldResidency({ residencyName: 'Hostel', category: 'prabhupada world' }), true);
  assert.equal(isPrabhupadaWorldResidency({ residencyName: 'Hostel', segment: 'PW' }), true);
  assert.equal(residencyMatchesDepartment({ category: 'pw' }, 'PW'), true);
});

test('the name is not a category', () => {
  assert.equal(isPrabhupadaWorldResidency({ residencyName: 'Prabhupada World' }), false);
  assert.equal(isPrabhupadaWorldResidency({ residencyName: 'pw hostel' }), false);
  assert.equal(isPrabhupadaWorldCategory('FOLK PW House'), false);
  assert.equal(isActiveFolkResidency({ residencyName: 'PW Lodge', isActive: true }), true);
  assert.equal(isActiveFolkResidency({ category: 'PW', isActive: false }), false);
});
