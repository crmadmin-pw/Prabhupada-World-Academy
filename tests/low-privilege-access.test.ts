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
const entrySecret = 'stranger-entry-secret-note';
const preachingSecret = 777123;

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
    [sdk.AshrayUpgradeRequests, { name: 'AshrayUpgradeRequests', rows: [{ id: 'ashray-req', userId: stranger.userId, status: 'Pending', currentLevel: 'Jigyasa', requestedLevel: 'Shraddhavan' }] }],
    [sdk.SadhanaEntries, { name: 'SadhanaEntries', rows: [{
      id: 'stranger-entry', entryId: 'ENTRY-STRANGER', user: stranger.id, entryDate: '2026-01-05', totalScore: 10, maxScore: 16,
      templateMode: 'NON_RESIDENT_TEMPLATE', fieldValuesJson: JSON.stringify({ chanting: 16, notes: entrySecret }),
    }] }],
    [sdk.BvslPreachingEntries, { name: 'BvslPreachingEntries', rows: [{ id: 'stranger-preaching', user: stranger.id, entryDate: '2026-01-05', prBooksDistributed: preachingSecret }] }],
    [sdk.Services, { name: 'Services', rows: [] }],
    [sdk.SkillCatalog, { name: 'SkillCatalog', rows: [] }],
    [sdk.Config, { name: 'Config', rows: [{ id: 'counter', configKey: 'counter:sadhanaEntryN', configValue: '3' }] }],
    [sdk.Guides, { name: 'Guides', rows: [] }],
    [sdk.FolkResidencies, { name: 'FolkResidencies', rows: [] }],
  ]);
  const reads: string[] = [];
  const sadhanaWrites: string[] = [];
  let lastSadhanaRecord: any;
  for (const [table, fixture] of fixtures) {
    const query = (options: any = {}) => {
      reads.push(fixture.name);
      if (options.offset) return [];
      return fixture.rows.filter((row: any) => matches(row, options));
    };
    t.mock.method(table, 'findAll', async (options: any) => ({ records: query(options), hasMore: false }));
    t.mock.method(table, 'findOne', async (options: any) => query(options)[0]);
    const recordSadhanaWrite = (args: any) => {
      if (fixture.name === 'SadhanaEntries') {
        sadhanaWrites.push(fixture.name);
        lastSadhanaRecord = args?.record;
      }
      return { id: 'saved' };
    };
    t.mock.method(table, 'create', async (args: any) => recordSadhanaWrite(args));
    t.mock.method(table, 'update', async (args: any) => recordSadhanaWrite(args));
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
    ['another member\'s sadhana entry by date', 'getEntryDetail', { userId: stranger.userId, entryDate: '2026-01-05' }, entrySecret],
    ['another member\'s sadhana entry by id', 'getEntryDetail', { entryId: 'ENTRY-STRANGER' }, entrySecret],
    ['another member\'s preaching entry', 'getBvPreachingEntry', { userId: stranger.userId, entryDate: '2026-01-05' }, String(preachingSecret)],
    ['ashray upgrade approval', 'approveAshrayUpgrade', { requestId: 'ashray-req', action: 'pass' }, 'Passed'],
    ['adding a group member', 'addGroupMember', { groupId: secretGroup.groupId, userId: stranger.userId }, secretGroup.joinToken],
    ['removing a group member', 'removeGroupMember', { groupId: secretGroup.groupId, userId: stranger.userId }, secretGroup.joinToken],
    ['group member list', 'getGroupMembers', { groupDbId: secretGroup.id }, stranger.phone],
    ['pending join requests', 'getPendingBvJoinRequests', { groupId: secretGroup.groupId }, stranger.phone],
    ['BV attendance table', 'getBvAdminTable', { guideId: 'ALL' }, stranger.phone],
    ['creating a service', 'createService', { serviceName: 'Kitchen' }, 'Kitchen'],
    ['editing the skill catalog', 'manageCatalogSkill', { action: 'create', skillName: 'Cooking' }, 'Cooking'],
    ['the member export', 'exportUserData', {}, stranger.phone],
    ['another member\'s 1:1 eligibility', 'saveOneToOneEligibility', { userId: stranger.id, eligibility: 'Not Eligible' }, 'success":true'],
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

  await t.test('tampered scores never reach storage', async () => {
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
    // Prabhupada World days are scored on the server from the raw answers, so
    // the claimed points and percentage are discarded rather than stored.
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.totalScore, 0);
    assert.equal(result.body.scorePercent, 0);
    assert.equal(sadhanaWrites.length, before + 1);
    assert.equal(lastSadhanaRecord.totalScore, 0);
    assert.equal(lastSadhanaRecord.scorePercent, 0);
  });
});
