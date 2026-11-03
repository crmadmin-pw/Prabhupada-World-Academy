import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserRecord } from 'firebase-admin/auth';
import { getFirestoreDb } from '../src/lib/app-backend-sdk';
import { recoverVerifiedAccount } from '../src/lib/automaticAccountRecovery';

test('concurrent recovery attempts cannot both claim one profile', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const db = getFirestoreDb();
  assert.ok(db);
  const email = 'transaction-member@example.test';
  const profileId = 'legacy-transaction-profile';
  await db.collection('Users').doc(profileId).set({ userId: 'USER-TRANSACTION', email, role: 'User', status: 'Active', segment: 'PW' });
  const attempt = (uid: string) => recoverVerifiedAccount({ uid, email, emailVerified: true }, {
    db,
    auth: {
      getUserByEmail: async () => ({ uid, email, emailVerified: true, disabled: false } as UserRecord),
      getUser: async () => { throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' }); },
    },
  });
  const results = await Promise.all([attempt('login-a'), attempt('login-b')]);
  assert.equal(results.filter(Boolean).length, 1);
  const linked = (await db.collection('Users').doc(profileId).get()).data();
  const winner = results.find(Boolean)?.firebaseUid;
  assert.equal(linked.firebaseUid, winner);
  const audit = await db.collection('AccountLinkRequests').doc(`acct-link-${winner}`).get();
  assert.equal(audit.data()?.status, 'Approved');
  assert.equal(audit.data()?.approvedProfileId, profileId);
  const loser = winner === 'login-a' ? 'login-b' : 'login-a';
  assert.equal((await db.collection('AccountLinkRequests').doc(`acct-link-${loser}`).get()).exists, false);
});
