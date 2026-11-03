/* eslint-disable @typescript-eslint/no-explicit-any -- the fake implements the Firestore transaction surface used by this test */
import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverVerifiedAccount } from '../src/lib/automaticAccountRecovery';

const uid = 'firebase-login';
const email = 'member@example.test';
const profile = { id: 'legacy-profile', userId: 'USER-103', email, role: 'User', status: 'Active', segment: 'PW', fullName: 'Member' };
const identity = { uid, email, emailVerified: true };

type Row = Record<string, any>;
function fixture(options: { users?: Row[]; request?: Row | null; holds?: Row[]; groups?: Row[]; otherAuth?: boolean; login?: Row } = {}) {
  const users = structuredClone(options.users ?? [profile]);
  const requests = options.request ? [structuredClone(options.request)] : [];
  const holds = options.holds ?? [];
  const groups = options.groups ?? [];
  const writes: any[] = [];
  const collection = (name: string): any => ({
    name,
    doc: (id: string) => ({ name, id }),
    select() { return this; },
    where: (_field: string, _op: string, owners: string[]) => ({ name, owners, limit() { return this; } }),
  });
  const db = {
    collection,
    async runTransaction(callback: (tx: any) => Promise<any>) {
      const pending: any[] = [];
      const tx = {
        async get(ref: any) {
          if (ref.name === 'Users' && ref.id) {
            const row = users.find(item => item.id === ref.id);
            return { id: ref.id, exists: !!row, data: () => row };
          }
          if (ref.name === 'Users') return { docs: users.map(row => ({ id: row.id, data: () => row })) };
          if (ref.name === 'BvGroups') return { docs: groups.map(row => ({ data: () => row })) };
          if (ref.name === 'AccountDeletionHolds') return { empty: !holds.some(row => ref.owners.includes(row.ownerId)) };
          if (ref.name === 'AccountLinkRequests') {
            const row = requests.find(item => item.id === ref.id);
            return { exists: !!row, data: () => row };
          }
          throw new Error('Unexpected transaction read');
        },
        update: (ref: any, data: any) => pending.push({ op: 'update', ref, data }),
        set: (ref: any, data: any) => pending.push({ op: 'set', ref, data }),
      };
      const result = await callback(tx);
      writes.push(...pending);
      return result;
    },
  };
  const auth = {
    async getUserByEmail() { return options.login ?? { uid, email, emailVerified: true, disabled: false }; },
    async getUser() { if (options.otherAuth) return { uid: profile.id }; throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' }); },
  };
  return { db, auth, writes };
}

const pending = { id: `acct-link-${uid}`, authUid: uid, email, status: 'Pending', candidateProfileIds: [profile.id], createdAt: '2026-01-01' };

test('verified member recovers one unlinked profile and resolves an existing review atomically', async () => {
  const f = fixture({ users: [profile, { id: uid, email, createdAt: '2026-01-01' }], request: pending });
  const result = await recoverVerifiedAccount(identity, f);
  assert.equal(result.id, profile.id);
  assert.equal(result.firebaseUid, uid);
  assert.equal(result.userId, profile.userId);
  assert.deepEqual(f.writes.map(write => [write.op, write.ref.name, write.ref.id]), [
    ['update', 'Users', profile.id], ['set', 'AccountLinkRequests', `acct-link-${uid}`],
  ]);
  assert.deepEqual(Object.keys(f.writes[0].data).sort(), ['authLinkedAt', 'firebaseUid']);
  assert.equal(f.writes[1].data.status, 'Approved');
  assert.equal(f.writes[1].data.createdAt, pending.createdAt);
});

test('ambiguous, already linked, deleted, held, privileged and rejected cases cannot recover', async () => {
  const cases = [
    { users: [profile, { ...profile, id: 'duplicate', email: 'MEMBER@example.test' }] },
    { users: [{ ...profile, firebaseUid: 'someone-else' }] },
    { users: [{ ...profile, status: 'Account Deleted' }] },
    { users: [{ ...profile, status: 'Pending Deletion' }] },
    { users: [profile, { ...profile, id: 'duplicate-user-id', email: 'other@example.test' }] },
    { users: [{ ...profile, isBvAdmin: true }] },
    { groups: [{ bvslLeader: profile.id }] },
    { holds: [{ ownerId: profile.userId }] },
    { request: { ...pending, status: 'Rejected' } },
    { request: { ...pending, candidateProfileIds: ['another-profile'] } },
    { otherAuth: true },
    { login: { uid: 'different-login', email, emailVerified: true } },
    { login: { uid, email, emailVerified: false } },
  ];
  for (const options of cases) {
    const f = fixture(options);
    assert.equal(await recoverVerifiedAccount(identity, f), null, JSON.stringify(options));
    assert.deepEqual(f.writes, []);
  }
  const f = fixture();
  assert.equal(await recoverVerifiedAccount({ ...identity, emailVerified: false }, f), null);
  assert.deepEqual(f.writes, []);
});
