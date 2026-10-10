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
  const namedAnnex = { residencyName: 'Prabhupada World Annex', category: 'FOLK' };
  assert.equal(residencyMatchesDepartment(namedAnnex, 'FOLK'), true);
});

test('lowercase and spaced category values count as Prabhupada World', () => {
  assert.equal(isPrabhupadaWorldCategory('pw'), true);
  assert.equal(isPrabhupadaWorldCategory('Prabhupada World'), true);
  assert.equal(isPrabhupadaWorldCategory('prabhupada-world'), true);
  const namedCategory = { residencyName: 'Hostel', category: 'prabhupada world' };
  const namedSegment = { residencyName: 'Hostel', segment: 'PW' };
  assert.equal(isPrabhupadaWorldResidency(namedCategory), true);
  assert.equal(isPrabhupadaWorldResidency(namedSegment), true);
  assert.equal(residencyMatchesDepartment({ category: 'pw' }, 'PW'), true);
});

test('the name is not a category', () => {
  const namedWorld = { residencyName: 'Prabhupada World' };
  const namedHostel = { residencyName: 'pw hostel' };
  const namedLodge = { residencyName: 'PW Lodge', isActive: true };
  assert.equal(isPrabhupadaWorldResidency(namedWorld), false);
  assert.equal(isPrabhupadaWorldResidency(namedHostel), false);
  assert.equal(isPrabhupadaWorldCategory('FOLK PW House'), false);
  assert.equal(isActiveFolkResidency(namedLodge), true);
  assert.equal(isActiveFolkResidency({ category: 'PW', isActive: false }), false);
});
