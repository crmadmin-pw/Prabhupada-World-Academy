import { apiUser } from './helpers/apiUser';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import sendPushNotifications, { encryptPayload } from '../src/api/sendPushNotifications';
import subscribePush from '../src/api/subscribePush';
import { Users, SadhanaEntries, PushSubscriptions } from '../src/lib/app-backend-sdk';
import { isSadhanaReminderDue } from '../src/lib/sadhanaReminderSchedule';

test('native Web Push payload can be decrypted by an independent RFC 8291 receiver', async () => {
  const receiver = createECDH('prime256v1');
  const receiverPublic = receiver.generateKeys();
  const auth = randomBytes(16);
  const message = JSON.stringify({ title: '📿 Sadhana Reminder', body: 'Please submit today.' });
  const encrypted = await encryptPayload(receiverPublic.toString('base64url'), auth.toString('base64url'), message);
  const wire = Buffer.from(encrypted.body);
  assert.equal(wire.readUInt32BE(16), 4096);
  assert.equal(wire[20], 65);
  const serverPublic = wire.subarray(21, 86);
  const shared = receiver.computeSecret(serverPublic);
  const ikm = hkdfSync('sha256', shared, auth, Buffer.concat([
    Buffer.from('WebPush: info\0'), receiverPublic, serverPublic,
  ]), 32);
  const salt = wire.subarray(0, 16);
  const key = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdfSync('sha256', Buffer.from(ikm), salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce));
  decipher.setAuthTag(wire.subarray(-16));
  const clear = Buffer.concat([decipher.update(wire.subarray(86, -16)), decipher.final()]);
  assert.equal(clear.at(-1), 2);
  assert.equal(clear.subarray(0, -1).toString(), message);
});

test('in-app dispatch reaches missing members with zero native subscriptions, excludes submitted and other departments', async t => {
  const users = [
    { id: 'missing', status: 'Active', segment: 'PW', email: 'missing@example.invalid' },
    { id: 'done', userId: 'public-done', status: 'Active', segment: 'PW' },
    { id: 'folk', status: 'Active', segment: 'FOLK' },
  ];
  t.mock.method(Users, 'findAll', async () => ({ records: users, hasMore: false }));
  t.mock.method(PushSubscriptions, 'findAll', async () => ({ records: [], hasMore: false }));
  t.mock.method(SadhanaEntries, 'findAll', async () => ({ records: [{ user: ['public-done'] }], hasMore: false }));
  let broadcast: any;
  t.mock.method(fs, 'writeFileSync', (file: any, body: any) => {
    assert.equal(String(file), '/tmp/pw-latest-broadcast.json');
    broadcast = JSON.parse(String(body));
  });
  const result = await sendPushNotifications.execute({
    input: { reminderSlot: 'night-1', segment: 'PW', checkDate: '2026-09-06' },
    context: { user: apiUser({ id: 'admin', isActive: true, capabilities: ['notifications.send'] }) },
  });
  assert.equal(result.inAppRecipients, 1);
  assert.deepEqual(broadcast.inviteeIds, ['missing']);
  assert.deepEqual(broadcast.inviteeEmails, ['missing@example.invalid']);
  assert.equal(result.sent, 0);
});

test('Sadhana reminders exclude PW admins and FOLK guides from every delivery channel', async t => {
  const users = [
    { id: 'pw-member', status: 'Active', segment: 'PW', email: 'member@example.invalid' },
    { id: 'pw-admin', status: 'Active', segment: 'PW', role: 'Admin', email: 'admin@example.invalid' },
    { id: 'pw-super-admin', status: 'Active', segment: 'PW', isBvSuperAdmin: true, email: 'super@example.invalid' },
    { id: 'folk-guide', status: 'Active', segment: 'FOLK', role: 'Guide', email: 'guide@example.invalid' },
    { id: 'folk-super-guide', status: 'Active', segment: 'FOLK', role: 'Super Guide', email: 'super-guide@example.invalid' },
    { id: 'folk-member', status: 'Active', segment: 'FOLK', email: 'folk-member@example.invalid' },
  ];
  t.mock.method(Users, 'findAll', async () => ({ records: users, hasMore: false }));
  t.mock.method(PushSubscriptions, 'findAll', async () => ({ records: [], hasMore: false }));
  t.mock.method(SadhanaEntries, 'findAll', async () => ({ records: [], hasMore: false }));
  let broadcast: any;
  t.mock.method(fs, 'writeFileSync', (_file: any, body: any) => { broadcast = JSON.parse(String(body)); });

  const pw = await sendPushNotifications.execute({
    input: { reminderSlot: 'night-1', segment: 'PW', checkDate: '2026-09-06' },
    context: { user: apiUser({ id: 'sender', isActive: true, capabilities: ['notifications.send'] }) },
  });
  assert.equal(pw.inAppRecipients, 1);
  assert.deepEqual(broadcast.inviteeIds, ['pw-member']);

  const folk = await sendPushNotifications.execute({
    input: { reminderSlot: 'night-1', segment: 'FOLK', checkDate: '2026-09-06' },
    context: { user: apiUser({ id: 'sender', segment: 'FOLK', isActive: true, capabilities: ['notifications.send'] }) },
  });
  assert.equal(folk.inAppRecipients, 1);
  assert.deepEqual(broadcast.inviteeIds, ['folk-member']);
});

test('instant FOLK dispatch reaches only missing FOLK members', async t => {
  const users = [
    { id: 'folk-missing', status: 'Active', segment: 'FOLK', email: 'folk@example.invalid' },
    { id: 'pw-missing', status: 'Active', segment: 'PW', email: 'pw@example.invalid' },
  ];
  t.mock.method(Users, 'findAll', async () => ({ records: users, hasMore: false }));
  t.mock.method(PushSubscriptions, 'findAll', async () => ({ records: [], hasMore: false }));
  t.mock.method(SadhanaEntries, 'findAll', async () => ({ records: [], hasMore: false }));
  let broadcast: any;
  t.mock.method(fs, 'writeFileSync', (_file: any, body: any) => {
    broadcast = JSON.parse(String(body));
  });

  const result = await sendPushNotifications.execute({
    input: { reminderSlot: 'night-1', segment: 'FOLK', checkDate: '2026-09-08' },
    context: {
      user: apiUser({ id: 'folk-admin', segment: 'FOLK', isActive: true, capabilities: ['notifications.send'] }),
    },
  });

  assert.equal(result.inAppRecipients, 1);
  assert.deepEqual(broadcast.inviteeIds, ['folk-missing']);
  assert.deepEqual(broadcast.inviteeEmails, ['folk@example.invalid']);
  assert.equal(broadcast.segment, 'FOLK');
});

test('subscribing a phone preserves existing laptop subscriptions', async t => {
  const queries: any[] = [];
  t.mock.method(PushSubscriptions, 'findOne', async () => null);
  t.mock.method(PushSubscriptions, 'findAll', async (query: any) => {
    queries.push(query.filters);
    return { records: [], hasMore: false };
  });
  let record: any;
  t.mock.method(PushSubscriptions, 'create', async (input: any) => { record = input.record; return record; });
  await subscribePush.execute({ input: { endpoint: 'https://push.example.invalid/phone', p256dh: 'key', auth: 'auth' }, context: { user: apiUser({ id: 'member' }) } });
  assert.deepEqual(queries, [{ endpoint: 'https://push.example.invalid/phone' }]);
  assert.equal(record.user, 'member');
});

test('server reminder schedule follows configured IST time, enabled switch and day rules', () => {
  const config = { enabled: true, times: ['21:20'], frequency: 'daily', customDays: [1] };
  const sundaySlot = new Date('2026-09-06T15:50:00Z');
  assert.equal(isSadhanaReminderDue(config, sundaySlot), true);
  assert.equal(isSadhanaReminderDue(config, new Date('2026-09-06T15:49:00Z')), false);
  assert.equal(isSadhanaReminderDue({ ...config, enabled: false }, sundaySlot), false);
  assert.equal(isSadhanaReminderDue({ ...config, frequency: 'weekdays' }, sundaySlot), false);
  assert.equal(isSadhanaReminderDue({ ...config, frequency: 'custom' }, sundaySlot), false);
  assert.equal(isSadhanaReminderDue({ ...config, frequency: 'custom' }, new Date('2026-09-07T15:50:00Z')), true);
});
