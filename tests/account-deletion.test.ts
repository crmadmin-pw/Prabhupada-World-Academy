import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import deleteAccount from '../src/api/deleteAccount';
import {
  cancelAccountDeletion,
  ownedAccountTableNames,
  purgeDueAccountDeletions,
  scheduleAccountDeletion,
  type DeletionTable,
} from '../src/lib/accountDeletion';
import {
  ACCOUNT_DELETION_GRACE_MS,
  collectStoragePaths,
  deletionAuthorizationFailure,
  storageObjectPath,
} from '../src/lib/accountDeletionPolicy';

const PHOTO = 'https://firebasestorage.googleapis.com/v0/b/demo.firebasestorage.app/o/uploads%2Fcleanliness-inspection%2Fauth-1%2F2026%2F10%2Fphoto.jpg?alt=media&token=abc';
const PHOTO_PATH = 'uploads/cleanliness-inspection/auth-1/2026/10/photo.jpg';

function memoryTable(tableName: string, seed: any[] = []): DeletionTable & { rows: Map<string, any> } {
  const rows = new Map<string, any>();
  for (const record of seed) rows.set(String(record.id), { ...record });
  const matches = (record: any, filters?: Record<string, unknown>) => {
    if (!filters) return true;
    return Object.entries(filters).every(([field, expected]) => {
      const value = record[field];
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        const rule = expected as { in?: unknown[]; arrayContainsAny?: unknown[] };
        if (Array.isArray(rule.in)) return rule.in.map(String).includes(String(value));
        if (Array.isArray(rule.arrayContainsAny)) {
          const values = Array.isArray(value) ? value.map(String) : [];
          return rule.arrayContainsAny.some(item => values.includes(String(item)));
        }
      }
      return String(value) === String(expected);
    });
  };
  return {
    tableName,
    rows,
    async findOne(query) {
      if (query.id) return rows.get(String(query.id));
      return [...rows.values()].find(record => matches(record, query.filters));
    },
    async findAll(query = {}) {
      return { records: [...rows.values()].filter(record => matches(record, query.filters)), hasMore: false };
    },
    async create({ record }) {
      const saved = { ...record, id: String(record.id) };
      rows.set(saved.id, saved);
      return saved;
    },
    async update({ id, record }) {
      const saved = { ...(rows.get(String(id)) || { id }), ...record, id: String(id) };
      rows.set(String(id), saved);
      return saved;
    },
    async delete({ id }) {
      rows.delete(String(id));
    },
  };
}

function world() {
  const users = memoryTable('Users', [{
    id: 'profile-1',
    userId: 'USER-001',
    email: 'member@example.test',
    firebaseUid: 'auth-1',
    status: 'Active',
  }]);
  const rent = memoryTable('RentPayments', [
    { id: 'rent-1', user: 'profile-1', amountPaid: 10 },
    { id: 'rent-2', user: 'other-person', amountPaid: 99 },
  ]);
  const trips = memoryTable('Trips', [{ id: 'trip-1', user: 'profile-1', tripName: 'Yatra' }]);
  const services = memoryTable('ServiceAllocations', [{ id: 'alloc-1', user: ['profile-1'], weekDate: '2026-10-04' }]);
  const attendance = memoryTable('AttendanceRecords', [{ id: 'att-1', user: 'auth-1', date: '2026-10-05' }]);
  const challenges = memoryTable('ChallengeEnrollments', [{ id: 'ch-1', user: 'USER-001', currentStreak: 3 }]);
  const inspections = memoryTable('CleanlinessInspections', [{
    id: 'insp-1',
    inspector: ['profile-1'],
    photo: [{ url: PHOTO }],
  }]);
  const ownHash = createHash('sha256').update('profile-1:2026-10-01:svc-1').digest('hex');
  const otherHash = createHash('sha256').update('other-person:2026-10-01:svc-1').digest('hex');
  const ratings = memoryTable('ServiceRatings', [
    { id: 'rate-1', service: 'svc-1', ratingDate: '2026-10-01', raterHash: ownHash, rating: 5 },
    { id: 'rate-2', service: 'svc-1', ratingDate: '2026-10-01', raterHash: otherHash, rating: 4 },
  ]);
  const holds = memoryTable('AccountDeletionHolds');
  const ownedTables = [rent, trips, services, attendance, challenges, inspections, ratings];
  return { users, rent, trips, services, attendance, challenges, inspections, ratings, holds, ownedTables };
}

const request = {
  authId: 'auth-1',
  profileId: 'profile-1',
  email: 'member@example.test',
};

test('a confirm flag is not accepted and a fresh sign-in is required', () => {
  const nowMs = Date.parse('2026-10-05T12:00:00Z');
  const fresh = Math.floor(nowMs / 1000);
  assert.equal(deletionAuthorizationFailure({ confirmText: undefined, authTimeSeconds: fresh, nowMs })?.code, 'BAD_REQUEST');
  assert.equal(deletionAuthorizationFailure({ confirmText: 'delete', authTimeSeconds: fresh, nowMs })?.code, 'BAD_REQUEST');
  assert.equal(deletionAuthorizationFailure({ confirmText: 'DELETE', authTimeSeconds: fresh - 301, nowMs })?.code, 'UNAUTHORIZED');
  assert.equal(deletionAuthorizationFailure({ confirmText: 'DELETE', authTimeSeconds: null, nowMs })?.code, 'UNAUTHORIZED');
  assert.equal(deletionAuthorizationFailure({ confirmText: ' DELETE ', authTimeSeconds: fresh, nowMs }), null);
});

test('storage paths are limited to this app\'s upload objects', () => {
  assert.equal(storageObjectPath(PHOTO), PHOTO_PATH);
  assert.equal(storageObjectPath('uploads/cleanliness-inspection/auth-1/photo.jpg'), 'uploads/cleanliness-inspection/auth-1/photo.jpg');
  assert.equal(storageObjectPath('https://evil.example/uploads/secret.jpg'), null);
  assert.equal(storageObjectPath('uploads/../../etc/passwd'), null);
  const paths = collectStoragePaths({ photo: [{ url: PHOTO }], note: 'not a file' });
  assert.deepEqual([...paths], [PHOTO_PATH]);
});

test('scheduling hides owned records, keeps everyone else, and can be cancelled', async () => {
  const data = world();
  const nowMs = Date.parse('2026-10-05T12:00:00Z');
  const scheduled = await scheduleAccountDeletion({ ...request, ...data, nowMs });
  assert.equal(scheduled.status, 'scheduled');
  assert.equal(scheduled.purgeAt, new Date(nowMs + ACCOUNT_DELETION_GRACE_MS).toISOString());
  assert.equal(data.users.rows.get('profile-1').status, 'Pending Deletion');
  assert.equal(data.users.rows.get('profile-1').deletionPreviousStatus, 'Active');
  assert.equal(data.rent.rows.has('rent-1'), false);
  assert.equal(data.trips.rows.has('trip-1'), false);
  assert.equal(data.services.rows.has('alloc-1'), false);
  assert.equal(data.attendance.rows.has('att-1'), false);
  assert.equal(data.challenges.rows.has('ch-1'), false);
  assert.equal(data.inspections.rows.has('insp-1'), false);
  assert.equal(data.rent.rows.has('rent-2'), true);
  assert.equal(data.ratings.rows.has('rate-1'), false);
  assert.equal(data.ratings.rows.has('rate-2'), true);
  assert.equal(data.holds.rows.size, 7);

  const later = await scheduleAccountDeletion({ ...request, ...data, nowMs: nowMs + 10 * 24 * 60 * 60 * 1000 });
  assert.equal(later.purgeAt, scheduled.purgeAt);

  data.attendance.rows.set('att-2', { id: 'att-2', user: 'auth-1', date: '2026-10-06' });
  await scheduleAccountDeletion({ ...request, ...data, nowMs: nowMs + 1000 });
  assert.equal(data.attendance.rows.has('att-2'), false);

  const cancelled = await cancelAccountDeletion({ ...request, users: data.users, holds: data.holds, ownedTables: data.ownedTables });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(data.users.rows.get('profile-1').status, 'Active');
  assert.equal(data.rent.rows.get('rent-1').amountPaid, 10);
  assert.equal(data.trips.rows.get('trip-1').tripName, 'Yatra');
  assert.deepEqual(data.services.rows.get('alloc-1').user, ['profile-1']);
  assert.equal(data.attendance.rows.has('att-1'), true);
  assert.equal(data.challenges.rows.get('ch-1').currentStreak, 3);
  assert.equal(data.inspections.rows.get('insp-1').photo[0].url, PHOTO);
  assert.equal(data.ratings.rows.has('rate-1'), true);
  assert.equal(data.holds.rows.size, 0);
  assert.equal(data.rent.rows.has('rent-2'), true);
});

test('a failed hold restores records and leaves the account active', async () => {
  const data = world();
  let created = 0;
  const original = data.holds.create.bind(data.holds);
  data.holds.create = async args => {
    created += 1;
    if (created === 2) throw new Error('hold failed');
    return original(args);
  };
  await assert.rejects(
    () => scheduleAccountDeletion({ ...request, ...data, nowMs: Date.parse('2026-10-05T12:00:00Z') }),
    /was not deleted/,
  );
  assert.equal(data.users.rows.get('profile-1').status, 'Active');
  assert.equal(data.rent.rows.has('rent-1'), true);
  assert.equal(data.trips.rows.has('trip-1'), true);
  assert.equal(data.holds.rows.size, 0);
});

test('purge waits for the grace period, then removes the account, holds, and files', async () => {
  const data = world();
  const nowMs = Date.parse('2026-10-05T12:00:00Z');
  await scheduleAccountDeletion({ ...request, ...data, nowMs });
  const removed: { paths: string[]; uids: string[] }[] = [];
  const authDeleted: string[] = [];
  const early = await purgeDueAccountDeletions({
    nowMs,
    users: data.users,
    holds: data.holds,
    ownedTables: data.ownedTables,
    deleteFiles: async (paths, uids) => { removed.push({ paths, uids }); },
    deleteAuthUser: async uid => { authDeleted.push(uid); },
  });
  assert.deepEqual(early, { purged: 0, skipped: 1 });
  assert.equal(removed.length, 0);
  assert.equal(data.users.rows.has('profile-1'), true);

  const done = await purgeDueAccountDeletions({
    nowMs: nowMs + ACCOUNT_DELETION_GRACE_MS,
    users: data.users,
    holds: data.holds,
    ownedTables: data.ownedTables,
    deleteFiles: async (paths, uids) => { removed.push({ paths, uids }); },
    deleteAuthUser: async uid => { authDeleted.push(uid); },
  });
  assert.equal(done.purged, 1);
  assert.equal(data.users.rows.has('profile-1'), false);
  assert.equal(data.holds.rows.size, 0);
  assert.equal(data.rent.rows.has('rent-2'), true);
  assert.ok(removed[0].paths.includes(PHOTO_PATH));
  assert.ok(removed[0].uids.includes('auth-1'));
  assert.ok(authDeleted.includes('auth-1'));
});

test('account deletion covers the records that used to be left behind', () => {
  const names = ownedAccountTableNames();
  for (const name of ['RentPayments', 'Trips', 'ServiceAllocations', 'ServiceRatings', 'AttendanceRecords', 'ChallengeEnrollments', 'CleanlinessInspections']) {
    assert.ok(names.includes(name), name);
  }
});

test('the endpoint rejects a confirm flag and a stale sign-in before touching records', async () => {
  const user = {
    id: 'profile-1',
    uid: 'auth-1',
    email: 'member@example.test',
    authTime: Math.floor(Date.now() / 1000),
  };
  await assert.rejects(
    () => deleteAccount.execute({ input: { confirm: true }, context: { user } } as never),
    /Type DELETE/,
  );
  await assert.rejects(
    () => deleteAccount.execute({
      input: { confirmText: 'DELETE' },
      context: { user: { ...user, authTime: Math.floor(Date.now() / 1000) - 600 } },
    } as never),
    /Sign in again/,
  );
});
