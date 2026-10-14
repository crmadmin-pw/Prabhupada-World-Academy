import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, onSnapshot, terminate } from 'firebase/firestore';
import { NextRequest } from 'next/server';

test('native Firestore write trigger delivers to two authenticated listeners without application publishing', {
  skip: process.env.REALTIME_NATIVE_TRIGGER !== '1', timeout: 90_000,
}, async () => {
  assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-pwa-realtime');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  const { getFirestoreDb } = await import('../src/lib/app-backend-sdk');
  const { getAuth: adminAuth } = await import('firebase-admin/auth');
  const { POST } = await import('../src/app/api/run/[endpoint]/route');
  const { REALTIME_SUBSCRIPTIONS } = await import('../src/lib/realtimeCollections');
  const { deletionVersion } = await import('../functions/src/deletionVersion');
  const { expireQuery } = await import('../functions/src/expireQuery');
  const db = getFirestoreDb();
  const apps: ReturnType<typeof initializeApp>[] = [];
  const clients: ReturnType<typeof getFirestore>[] = [];
  const stops: (() => void)[] = [];
  const suffix = Date.now();
  const measurements: number[] = [];
  try {
    const fixtures = await Promise.all(['ADMIN', 'BVSL'].map(async role => {
      const uid = `native-${role}-${suffix}`;
      const email = `${uid}@example.invalid`;
      await adminAuth().createUser({ uid, email, emailVerified: true, password: 'Emulator-only-123!' });
      await db.collection('Users').doc(uid).set({ userId: uid, email, role, segment: 'PW', status: 'Active' });
      const app = initializeApp({ projectId: 'demo-pwa-realtime', apiKey: 'demo-key' }, uid);
      apps.push(app);
      const auth = getAuth(app);
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const { user } = await signInWithEmailAndPassword(auth, email, 'Emulator-only-123!');
      const token = await user.getIdToken();
      const read = () => POST(new NextRequest('http://localhost/api/run/getMeetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Realtime-Query': '1' },
        body: JSON.stringify({ department: 'PW' }),
      }), { params: Promise.resolve({ endpoint: 'getMeetings' }) });
      const response = await read();
      assert.equal(response.status, 200);
      const client = getFirestore(app);
      clients.push(client);
      connectFirestoreEmulator(client, '127.0.0.1', 8080);
      const queryToken = response.headers.get('X-Realtime-Token')!;
      assert.ok(queryToken);
      return { uid, client, read, queryToken, readVersion: response.headers.get('X-Realtime-Version')! };
    }));
    const [admin, rgf] = fixtures;
    const waitRevision = (fixture: typeof admin, previous: string, operation: string) => new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Native trigger did not deliver ${operation} after ${previous}`)), 30_000);
      const stop = onSnapshot(doc(fixture.client, 'RealtimeClients', fixture.uid, 'queries', fixture.queryToken), snapshot => {
        const version = String(snapshot.data()?.version || '');
        if (version > previous) { clearTimeout(timeout); stop(); resolve(version); }
      }, error => { clearTimeout(timeout); reject(error); });
      stops.push(stop);
    });
    let versions = fixtures.map(fixture => fixture.readVersion);
    const reference = db.collection('Meetings').doc(`native-meeting-${suffix}`);
    // No publishQueryChange call in this test: database CDC must do the work.
    for (const operation of ['create', 'update', 'delete']) {
      const waiting = fixtures.map((fixture, index) => waitRevision(fixture, versions[index], operation));
      const started = performance.now();
      if (operation === 'delete') await reference.delete();
      else await reference.set({ segment: 'PW', title: `Native ${operation}`, inviteeUserIds: [rgf.uid], scheduledAt: '2026-09-10T10:00:00Z' });
      versions = await Promise.all(waiting);
      measurements.push(performance.now() - started);
      for (const [index, fixture] of fixtures.entries()) {
        const response = await fixture.read();
        versions[index] = response.headers.get('X-Realtime-Version')!;
        const data = await response.json();
        const meeting = data.meetings.find((item: any) => item.id === reference.id);
        if (operation === 'delete') assert.equal(meeting, undefined);
        else assert.equal(meeting?.title, `Native ${operation}`);
      }
    }
    const notificationId = `native-message-${suffix}`;
    const notification = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Native notification routing timed out')), 30_000);
      const stop = onSnapshot(doc(rgf.client, 'RealtimeClients', rgf.uid, 'notifications', notificationId), snapshot => {
        if (snapshot.exists()) { clearTimeout(timeout); stop(); resolve(snapshot.data()); }
      }, reject);
      stops.push(stop);
    });
    await db.collection('NotificationBroadcasts').doc(notificationId).set({ id: notificationId, segment: 'PW', title: 'Instant notification', body: 'Fixture', sentAt: Date.now(), slot: 'instant', inviteeIds: [rgf.uid] });
    assert.equal((await notification).title, 'Instant notification');
    const deletionId = `duplicate-deletion-${suffix}`;
    assert.equal(await deletionVersion(db, deletionId), await deletionVersion(db, deletionId), 'deletion retries reuse one revision');

    // The emulator does not execute TTL policies. Deleting expired metadata
    // explicitly exercises the same native on-delete cleanup event.
    const signal = db.collection('RealtimeClients').doc(rgf.uid).collection('queries').doc(rgf.queryToken);
    const removedSignal = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Expired query signal was not removed')), 30_000);
      const stop = onSnapshot(doc(rgf.client, 'RealtimeClients', rgf.uid, 'queries', rgf.queryToken), snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.exists()) { clearTimeout(timeout); stop(); resolve(); }
      }, reject);
      stops.push(stop);
    });
    await db.collection(REALTIME_SUBSCRIPTIONS).doc(rgf.queryToken).delete();
    await removedSignal;
    await rgf.read();
    const renewed = db.collection(REALTIME_SUBSCRIPTIONS).doc(rgf.queryToken);
    for (let attempt = 0; attempt < 50 && !(await renewed.get()).exists; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await renewed.get()).exists, true, 'a fresh read registers again after the response');
    await expireQuery(db, rgf.queryToken, rgf.uid);
    assert.equal((await signal.get()).exists, true, 'delayed cleanup must not delete a renewed query');
    console.log(JSON.stringify({ result: 'passed', transport: 'native Firestore CDC to authenticated SDK listeners', operations: ['create', 'update', 'delete', 'notification'], commitRequestToListenerMs: measurements, listeners: 2 }));
  } finally {
    stops.forEach(stop => stop());
    await Promise.all(clients.map(terminate));
    await Promise.all(apps.map(deleteApp));
    await db.terminate();
  }
});
