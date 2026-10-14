import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { NextRequest } from 'next/server';

test('actual API authorization registers only successful scoped reads for PW admin, RGF and FOLK guide', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST, timeout: 60_000,
}, async () => {
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-pwa-realtime');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  const { getFirestoreDb } = await import('../src/lib/app-backend-sdk');
  const { getAuth: adminAuth } = await import('firebase-admin/auth');
  const { POST } = await import('../src/app/api/run/[endpoint]/route');
  const { publishQueryChange } = await import('../functions/src/publishQueryChange');
  const { firestoreVersion } = await import('../src/lib/realtimeQueryModel');
  const { REALTIME_SUBSCRIPTIONS } = await import('../src/lib/realtimeCollections');
  const db = getFirestoreDb();
  const suffix = Date.now();
  const apps: ReturnType<typeof initializeApp>[] = [];
  try {
    const fixtures = await Promise.all([
      { name: 'admin', role: 'ADMIN', segment: 'PW' },
      { name: 'rgf', role: 'BVSL', segment: 'PW', isBvsl: true },
      { name: 'folk', role: 'GUIDE', segment: 'FOLK' },
    ].map(async profile => {
      const uid = `api-${profile.name}-${suffix}`;
      const email = `${uid}@example.invalid`;
      await adminAuth().createUser({ uid, email, emailVerified: true, password: 'Emulator-only-123!' });
      await db.collection('Users').doc(uid).set({ ...profile, userId: uid, email, status: 'Active' });
      const app = initializeApp({ projectId: 'demo-pwa-realtime', apiKey: 'demo-key' }, uid);
      apps.push(app);
      const auth = getAuth(app);
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const { user } = await signInWithEmailAndPassword(auth, email, 'Emulator-only-123!');
      return { uid, token: await user.getIdToken() };
    }));
    const [admin, rgf, folk] = fixtures;
    const call = (token: string | undefined, department = 'PW') => POST(new NextRequest('http://localhost/api/run/getMeetings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Realtime-Query': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ department }),
    }), { params: Promise.resolve({ endpoint: 'getMeetings' }) });
    const responses = await Promise.all([call(admin.token), call(rgf.token), call(folk.token, 'FOLK')]);
    for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
    assert.ok(responses[0].headers.get('X-Realtime-Token'));
    assert.ok(responses[1].headers.get('X-Realtime-Token'));
    assert.deepEqual(await responses[2].json(), { meetings: [] });
    assert.equal(responses[2].headers.get('X-Realtime-Token'), null);
    assert.equal((await call(undefined)).status, 401);
    const forbidden = await call(rgf.token, 'FOLK');
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get('X-Realtime-Token'), null);

    await Promise.all([responses[0], responses[1]].map(async response => {
      const token = response.headers.get('X-Realtime-Token')!;
      const subscription = db.collection(REALTIME_SUBSCRIPTIONS).doc(token);
      for (let attempt = 0; attempt < 50 && !(await subscription.get()).exists; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal((await subscription.get()).exists, true, 'registration commits after the response');
    }));

    const reference = db.collection('Meetings').doc(`api-meeting-${suffix}`);
    const meeting = { title: 'Scoped fixture', segment: 'PW', status: 'SCHEDULED', inviteeUserIds: [rgf.uid], scheduledAt: '2026-09-10T10:00:00Z' };
    const committed = await reference.set(meeting);
    const version = firestoreVersion(committed.writeTime);
    const metrics = await publishQueryChange(db, { table: 'Meetings', id: reference.id, after: meeting, version });
    assert.ok(metrics.affected >= 2, 'both fixture scopes are affected; other demo admins may also be connected');
    const rgfSignal = db.collection('RealtimeClients').doc(rgf.uid).collection('queries').doc(responses[1].headers.get('X-Realtime-Token')!);
    assert.equal((await rgfSignal.get()).data()?.version, version);
    const invited = await (await call(rgf.token)).json();
    assert.ok(invited.meetings.some((item: any) => item.id === reference.id));

    const unrelated = { ...meeting, inviteeUserIds: ['someone-else'] };
    const unrelatedRef = db.collection('Meetings').doc(`api-unrelated-${suffix}`);
    const unrelatedCommit = await unrelatedRef.set(unrelated);
    await publishQueryChange(db, { table: 'Meetings', id: unrelatedRef.id, after: unrelated, version: firestoreVersion(unrelatedCommit.writeTime) });
    assert.equal((await rgfSignal.get()).data()?.version, version, 'uninvited RGF receives no signal');

    const removed = { ...meeting, inviteeUserIds: [] };
    const removal = await reference.set(removed);
    await publishQueryChange(db, { table: 'Meetings', id: reference.id, before: meeting, after: removed, version: firestoreVersion(removal.writeTime) });
    const afterRemoval = await (await call(rgf.token)).json();
    assert.equal(afterRemoval.meetings.some((item: any) => item.id === reference.id), false);

    // Use the same authenticated token immediately after a stored role change.
    await db.collection('Users').doc(admin.uid).update({ role: 'USER' });
    const afterRevocation = await (await call(admin.token)).json();
    assert.equal(afterRevocation.meetings.some((item: any) => item.id === reference.id), false);
    console.log(JSON.stringify({ result: 'passed', roles: ['PW admin', 'PW RGF', 'FOLK guide'], checks: ['actual API guards', 'scoped registration', 'invitation removal', 'immediate role revocation'] }));
  } finally {
    await Promise.all(apps.map(deleteApp));
    await db.terminate();
  }
});
