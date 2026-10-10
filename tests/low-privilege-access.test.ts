import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';
import { BV_DELETE_CONFIRMATION } from '../src/lib/confirmBvGroupDeletion';

// A verified Firebase ID token for one ordinary member. Authorization is the
// profile stored for that token, never a role written into the request body.
const projectId = 'demo-low-privilege-access';
const member = {
  id: 'low-privilege-member',
  userId: 'USER-LOW',
  email: 'member@example.invalid',
  role: 'User',
  status: 'Active',
  segment: 'PW',
  fullName: 'Ordinary Member',
  ashrayLevel: 'Jigyasa',
};
const stranger = {
  id: 'other-member',
  userId: 'USER-OTHER',
  email: 'other@example.invalid',
  role: 'User',
  status: 'Active',
  segment: 'PW',
  phone: '9000000099',
  fullName: 'Other Member',
};
const secretGroup = {
  id: 'secret-group',
  groupId: 'SECRET-GROUP',
  groupName: 'Secret Reading Group',
  isActive: true,
  segment: 'PW',
  joinToken: 'join-secret-token',
  whatsAppLink: 'https://chat.example/secret',
  bvslLeader: stranger.id,
  bvslId: stranger.userId,
};
const rentSecret = 'rent-secret-note';
const pendingSecret = 'pending-secret-phone';

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
function memberToken() {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: member.id,
    email: member.email,
    email_verified: true,
    iat: now,
    exp: now + 3600,
    auth_time: now,
  };
  const body = `${encode({ alg: 'RS256', kid: 'low-privilege-key' })}.${encode(claims)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url')}`;
}

function matches(record: any, query: any = {}) {
  if (query.id && record.id !== query.id) return false;
  return Object.entries(query.filters || {}).every(([key, value]: any) => {
    const actual = [record[key]].flat();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.in)) return actual.some(item => value.in.includes(item));
      return true;
    }
    return actual.includes(value);
  });
}

test('a signed-in member is blocked from sensitive pages and tampered scores', async t => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, { NODE_ENV: 'development', NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId });
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

  const created = getApps().length === 0;
  const app = created ? initializeApp({ projectId }) : getApps()[0];
  if (created) t.after(() => deleteApp(app));
  const auth = getAuth() as unknown as {
    idTokenVerifier: { signatureVerifier: { keyFetcher: { fetchPublicKeys(): Promise<Record<string, string>> } } };
  };
  t.mock.method(auth.idTokenVerifier.signatureVerifier.keyFetcher, 'fetchPublicKeys', async () => ({
    'low-privilege-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }));

  const sdk = await import('../src/lib/app-backend-sdk');
  const fixtures = new Map<any, { name: string; rows: any[] }>([
    [sdk.Users, { name: 'Users', rows: [member, stranger, {
      id: 'pending-stranger', userId: 'USER-PENDING', email: 'pending@example.invalid',
      role: 'User', status: 'Pending Approval', phone: pendingSecret, fullName: 'Pending Stranger',
    }] }],
    [sdk.BvGroups, { name: 'BvGroups', rows: [secretGroup] }],
    [sdk.BvGroupMembers, { name: 'BvGroupMembers', rows: [] }],
    [sdk.Trips, { name: 'Trips', rows: [{ id: 'trip-secret', user: stranger.id, tripName: 'Secret Trip', totalAmount: 900 }] }],
    [sdk.RentPayments, { name: 'RentPayments', rows: [{ id: 'rent-secret', user: stranger.id, amountDue: 500, notes: rentSecret }] }],
    [sdk.AshrayUpgradeRequests, { name: 'AshrayUpgradeRequests', rows: [] }],
    [sdk.SadhanaEntries, { name: 'SadhanaEntries', rows: [] }],
    [sdk.BvslPreachingEntries, { name: 'BvslPreachingEntries', rows: [] }],
    [sdk.Config, { name: 'Config', rows: [{ id: 'counter', configKey: 'counter:sadhanaEntryN', configValue: '3' }] }],
    [sdk.Guides, { name: 'Guides', rows: [] }],
    [sdk.FolkResidencies, { name: 'FolkResidencies', rows: [] }],
  ]);
  const reads: string[] = [];
  const sadhanaWrites: string[] = [];
  for (const [table, fixture] of fixtures) {
    const query = (options: any = {}) => {
      reads.push(fixture.name);
      if (options.offset) return [];
      return fixture.rows.filter((row: any) => matches(row, options));
    };
    t.mock.method(table, 'findAll', async (options: any) => ({ records: query(options), hasMore: false }));
    t.mock.method(table, 'findOne', async (options: any) => query(options)[0]);
    const recordSadhanaWrite = () => {
      if (fixture.name === 'SadhanaEntries') sadhanaWrites.push(fixture.name);
      return { id: 'saved' };
    };
    t.mock.method(table, 'create', async () => recordSadhanaWrite());
    t.mock.method(table, 'update', async () => recordSadhanaWrite());
    t.mock.method(table, 'delete', async () => { if (fixture.name === 'SadhanaEntries') sadhanaWrites.push(fixture.name); });
  }

  t.mock.method(console, 'error', () => {});
  const { POST } = await import('../src/app/api/run/[endpoint]/route');
  const token = memberToken();
  const call = async (endpoint: string, body: unknown, authenticated = true) => {
    const response = await POST(new NextRequest(`http://localhost/api/run/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ endpoint }) });
    return { status: response.status, body: await response.json() };
  };

  await t.test('the same login can read only this member\'s own profile data', async () => {
    const own = await call('getUserCrmData', { userId: member.id });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.userDbId, member.id);
    assert.equal(JSON.stringify(own.body).includes(rentSecret), false);
  });

  const blocked = [
    ['group detail', 'getBvGroupDetail', { groupId: secretGroup.groupId, role: 'SUPER_ADMIN' }, secretGroup.joinToken],
    ['BV member directory', 'getBvslMembers', { bvslId: stranger.userId, role: 'SUPER_ADMIN' }, stranger.phone],
    ['another member\'s rent and trips', 'getUserCrmData', { userId: stranger.id, role: 'SUPER_ADMIN' }, rentSecret],
    ['pending approvals', 'getPendingApprovals', { role: 'SUPER_ADMIN' }, pendingSecret],
    ['admin group directory', 'getAllBvGroupsAdmin', { guideId: 'ALL', role: 'SUPER_ADMIN' }, secretGroup.joinToken],
    ['group deletion', 'hardDeleteBvGroups', { deleteAll: true, confirmationPhrase: BV_DELETE_CONFIRMATION, role: 'SUPER_ADMIN' }, 'deleted'],
  ] as const;

  for (const [page, endpoint, body, secret] of blocked) {
    await t.test(`${page} stays closed`, async () => {
      const before = sadhanaWrites.length;
      reads.length = 0;
      const result = await call(endpoint, body);
      assert.equal(result.status, 403, `${page}: ${JSON.stringify(result.body)}`);
      assert.equal(JSON.stringify(result.body).includes(secret), false, page);
      assert.equal(sadhanaWrites.length, before, `${page} must not write`);
      if (endpoint === 'getUserCrmData') {
        assert.equal(reads.includes('Trips'), false);
        assert.equal(reads.includes('RentPayments'), false);
      }
    });
  }

  await t.test('a missing login is rejected before any of those pages', async () => {
    const result = await call('getBvGroupDetail', { groupId: secretGroup.groupId }, false);
    assert.equal(result.status, 401);
    assert.equal(JSON.stringify(result.body).includes(secretGroup.joinToken), false);
  });

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await t.test('an honest sadhana submission from this member is stored', async () => {
    const before = sadhanaWrites.length;
    const result = await call('submitSadhana', {
      userId: 'someone-else',
      entryDate: today,
      totalScore: 0,
      templateMode: 'NON_RESIDENT_TEMPLATE',
      fieldValues: { chanting: 0, reading: 0 },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.totalScore, 0);
    assert.equal(sadhanaWrites.length, before + 1);
  });

  await t.test('tampered scores are rejected and nothing is saved', async () => {
    const before = sadhanaWrites.length;
    const result = await call('submitSadhana', {
      userId: member.id,
      entryDate: today,
      totalScore: 100,
      scorePercent: 100,
      maxScore: 16,
      templateMode: 'NON_RESIDENT_TEMPLATE',
      fieldValues: {
        chanting: 0,
        reading: 0,
        _per_field: { chanting: 8, reading: 4 },
        _pts_chanting: 8,
      },
    });
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.match(result.body.message, /do not match the recorded sadhana/);
    assert.equal(sadhanaWrites.length, before);
  });
});
