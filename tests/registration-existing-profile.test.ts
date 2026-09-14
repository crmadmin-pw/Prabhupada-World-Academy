import assert from 'node:assert/strict';
import test from 'node:test';
import { Guides, Users } from '../src/lib/app-backend-sdk';
import registerUser from '../src/api/registerUser';

const registrationInput = {
  fullName: 'Existing Member', phoneCountryCode: '+91', phone: '9876543210',
  phoneE164: '+919876543210', email: 'member@example.test', guideId: 'GUIDE-007',
  residencyUserClaim: false, isPrabhupadaWorldUser: false,
};

test('an active migrated member selecting another guide becomes a pending registration on the same profile', async t => {
  const existing = { id: 'legacy-user-doc', userId: 'USER-087', email: registrationInput.email,
    status: 'Active', guide: 'old-guide-doc', firebaseUid: 'auth-user' };
  const updates: any[] = [];
  t.mock.method(Guides, 'findOne', async (query: any) => {
    if (query.id === 'old-guide-doc') return { id: 'old-guide-doc', guideId: 'GUIDE-004' };
    if (query.filters?.guideId === 'GUIDE-007') return { id: 'new-guide-doc', guideId: 'GUIDE-007', fullName: 'Harinamamrta Das', segment: 'FOLK' };
    return undefined;
  });
  t.mock.method(Users, 'findAll', async (query: any) => ({
    records: query.filters?.email === registrationInput.email ? [existing] : [], hasMore: false,
  }));
  t.mock.method(Users, 'update', async (change: any) => { updates.push(change); return change; });

  const result = await (registerUser as any).execute({
    input: registrationInput,
    context: { user: { id: 'auth-user', email: registrationInput.email, role: 'User' } },
  });
  assert.equal(result.status, 'PENDING_APPROVAL');
  assert.equal(result.userId, 'USER-087');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'legacy-user-doc');
  assert.equal(updates[0].record.guide, 'new-guide-doc');
  assert.equal(updates[0].record.selectedGuideId, 'new-guide-doc');
  assert.equal(updates[0].record.guideName, 'Harinamamrta Das');
  assert.equal(updates[0].record.status, 'Pending Approval');
  assert.equal(updates[0].record.firebaseUid, 'auth-user');
});

test('a phone owned by another account returns a conflict instead of phantom pending success', async t => {
  t.mock.method(Guides, 'findOne', async (query: any) =>
    query.filters?.guideId === 'GUIDE-007'
      ? { id: 'new-guide-doc', guideId: 'GUIDE-007', segment: 'FOLK' }
      : undefined);
  t.mock.method(Users, 'findAll', async (query: any) => ({
    records: query.filters?.phone ? [{ id: 'other-user', userId: 'USER-999', email: 'other@example.test' }] : [],
    hasMore: false,
  }));
  await assert.rejects((registerUser as any).execute({
    input: registrationInput,
    context: { user: { id: 'auth-user', email: registrationInput.email, role: 'User' } },
  }), /phone number is already registered/i);
});
