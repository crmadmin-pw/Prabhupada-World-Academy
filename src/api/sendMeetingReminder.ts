import { z } from 'zod';
import { createEndpoint, Meetings, AppError, getFirestoreDb } from '@/lib/backend-sdk';
import { storeBroadcast } from '@/lib/notificationBroadcast';
import { claimMeetingReminder, reminderHash } from '@/lib/meetingReminderDispatch';
import { resolveMeetingRecipients, meetingSubscriptionTargets, identityKeys } from '@/lib/meetingReminderRecipients';
import { meetingStartMs, reminderWindow, MEETING_REMINDERS } from '@/lib/meetingReminderSchedule';

// ── VAPID + Web Push helpers (pure Web Crypto — no npm packages) ──

function base64UrlEncode(buf: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function generateVapidJwt(audience: string, subject: string, privateKeyBase64: string, publicKeyBase64: string): Promise<{ token: string; publicKeyBytes: Uint8Array }> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const rawPrivKey = base64UrlDecode(privateKeyBase64);
  const jwk = {
    kty: 'EC' as const,
    crv: 'P-256' as const,
    x: base64UrlEncode(rawPrivKey.slice(0, 32).buffer),
    y: '',
    d: base64UrlEncode(rawPrivKey.buffer as ArrayBuffer),
  };

  const rawPubKey = base64UrlDecode(publicKeyBase64);
  jwk.x = base64UrlEncode(rawPubKey.slice(1, 33).buffer as ArrayBuffer);
  jwk.y = base64UrlEncode(rawPubKey.slice(33, 65).buffer as ArrayBuffer);

  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    signingKey,
    new TextEncoder().encode(unsignedToken),
  );

  const sigBytes = new Uint8Array(sig);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32);
  } else {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }
  const rawSig = new Uint8Array(64);
  rawSig.set(r.length > 32 ? r.slice(r.length - 32) : r, 32 - Math.min(r.length, 32));
  rawSig.set(s.length > 32 ? s.slice(s.length - 32) : s, 64 - Math.min(s.length, 32));

  const token = `${unsignedToken}.${base64UrlEncode(rawSig.buffer as ArrayBuffer)}`;
  return { token, publicKeyBytes: rawPubKey };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const saltForKey = salt.length ? salt : new Uint8Array(32);
  const saltKey = await crypto.subtle.importKey('raw', saltForKey.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm.buffer as ArrayBuffer));
  const prkKey = await crypto.subtle.importKey('raw', prk.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoLen = new Uint8Array([...info, 1]);
  const okm = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoLen.buffer as ArrayBuffer));
  return okm.slice(0, length);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((a, b) => a + b.length, 0);
  const result = new Uint8Array(len);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

export async function encryptPayload(
  p256dhKey: string,
  authSecret: string,
  payload: string,
): Promise<{ body: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const clientPublicKey = base64UrlDecode(p256dhKey);
  const clientAuth = base64UrlDecode(authSecret);

  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  const clientKey = await crypto.subtle.importKey('raw', clientPublicKey.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 section 3.4. Chrome rejects the legacy aesgcm derivation when
  // it is sent with the modern aes128gcm content encoding.
  const authInfo = concat(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicKey,
    localPublicKeyRaw,
  );
  const prkCombine = await hkdf(clientAuth, sharedSecret, authInfo, 32);

  const keyInfoBuf = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const contentKey = await hkdf(salt, prkCombine, keyInfoBuf, 16);

  const nonceInfoBuf = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, prkCombine, nonceInfoBuf, 12);

  const paddedPayload = concat(new TextEncoder().encode(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', contentKey.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, aesKey, paddedPayload.buffer as ArrayBuffer));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const body = concat(salt, rs, new Uint8Array([65]), localPublicKeyRaw, encrypted);

  return { body, salt, localPublicKey: localPublicKeyRaw };
}

async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payloadStr: string,
  vapidPrivate: string,
  vapidPublic: string,
): Promise<number> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const { token, publicKeyBytes } = await generateVapidJwt(audience, 'mailto:admin@prabhupadaworld.org', vapidPrivate, vapidPublic);
  const { body } = await encryptPayload(sub.p256dh, sub.auth, payloadStr);

  const vapidPubB64 = base64UrlEncode(publicKeyBytes.buffer as ArrayBuffer);

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: '600',
      // Meeting reminders are time-critical. High urgency allows Google/Chrome
      // to wake a backgrounded or installed PWA promptly under battery saving.
      Urgency: 'high',
      Authorization: `vapid t=${token}, k=${vapidPubB64}`,
    },
    body: body.buffer as ArrayBuffer,
    signal: AbortSignal.timeout(8000),
  });

  return resp.status;
}

export default createEndpoint({
  description: 'Send meeting reminder notifications to invitees',
  public: true,
  inputSchema: z.object({
    meetingId: z.string().min(1),
    reminderType: z.enum(['TEN_MINUTES', 'ONE_MINUTE']).optional().default('TEN_MINUTES'),
    // Used only by the server scheduler. Interactive sends still require the
    // caller to hold the meetings.manage capability.
    cronSecret: z.string().min(16).max(256).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    sent: z.number(),
    failed: z.number(),
    skipped: z.number(),
    inAppRecipients: z.number(),
    message: z.string(),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => executeMeetingReminder(input, context),
});

/** Dependency arguments allow isolated delivery tests without contacting Firebase or participants. */
export async function executeMeetingReminder(input: any, context: any, db = getFirestoreDb(), publish = storeBroadcast) {
    const validCronSecrets = [process.env.APP_CRON_SECRET, process.env.ZITE_CRON_SECRET].filter(Boolean);
    const isCron = !!input.cronSecret && validCronSecrets.includes(input.cronSecret);
    const canManageMeetings = !!(
      context?.user?.isActive &&
      (context.user.capabilities?.includes('*') || context.user.capabilities?.includes('meetings.manage'))
    );
    if (!isCron && !canManageMeetings) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized to send meeting reminders' });
    }
    if (!isCron && String(context?.user?.segment || '').trim().toUpperCase() === 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'FOLK meeting reminders are disabled' });
    }

    const empty = (message: string) => ({ success: true, sent: 0, failed: 0, skipped: 0, inAppRecipients: 0, message });
    const type = input.reminderType || 'TEN_MINUTES';
    const definition = MEETING_REMINDERS.find(item => item.type === type)!;
    const meeting = await Meetings.findOne({ id: input.meetingId });
    if (!meeting) throw new AppError({ code: 'NOT_FOUND', message: 'Meeting not found' });
    if (String(meeting.segment || 'PW').trim().toUpperCase() === 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'FOLK meeting reminders are disabled' });
    }
    const start = meetingStartMs(String(meeting.scheduledAt || ''));
    const window = reminderWindow(start, type);
    if (!Number.isFinite(start) || String(meeting.status || 'SCHEDULED').toUpperCase() !== 'SCHEDULED'
      || Date.now() < window.from || Date.now() >= window.until) return empty('This reminder is not due.');
    if (meeting[definition.sentField]) return empty('This reminder has already been completed.');

    const lease = await claimMeetingReminder(meeting.id, meeting.scheduledAt, type, db);
    if (!lease) return empty('This reminder is being processed.');
    try {
      const recipients = await resolveMeetingRecipients(meeting);
      const inviteeIds = [...new Set(recipients.flatMap(user => user.ids))];
      const inviteeEmails = [...new Set(recipients.map(user => user.email).filter(Boolean))];
      if (!recipients.length) return empty('No participants to notify.');
      const startStr = new Date(start).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
      });
      const title = '📅 Upcoming meeting';
      const body = `"${meeting.title}" starts at ${startStr} IST. Tap to join.`;
      const broadcastId = `meeting-${lease.key}`;
      const link = String(meeting.locationOrLink || '').trim();
      const targetUrl = link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : '/dashboard#meetings';
      const audience = reminderHash([inviteeIds.slice().sort(), inviteeEmails.slice().sort()]);
      // In-app delivery must not depend on push subscriptions or working VAPID keys.
      if (lease.checkpoint.broadcastAudience !== audience) {
        await publish(title, body, 'meeting', undefined, broadcastId, inviteeIds, targetUrl, inviteeEmails, 'PW');
        lease.checkpoint.broadcastAudience = audience;
        await lease.save();
      }
      const targetSubs = await meetingSubscriptionTargets(recipients);
      // Recipient lists are not needed on a device and can exceed Web Push payload limits.
      const payload = JSON.stringify({ id: broadcastId, title, body, slot: 'meeting', url: targetUrl });
      const vapidPrivate = process.env.APP_VAPID_PRIVATE_KEY || process.env.ZITE_VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || '';
      const vapidPublic = process.env.APP_VAPID_PUBLIC_KEY || process.env.ZITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
      const delivered = new Set<string>(lease.checkpoint.delivered);
      const retired = new Set<string>(lease.checkpoint.retired);
      const keyOf = (sub: any) => reminderHash([sub.endpoint, sub.p256DhKey, sub.authKey]);
      const pending = targetSubs.filter(sub => !delivered.has(keyOf(sub)) && !retired.has(keyOf(sub)));
      let sent = 0, failed = 0;
      let skipped = recipients.filter(user => !targetSubs.some(sub => {
        const keys = identityKeys(sub);
        return user.ids.some(id => keys.includes(id)) || (user.email && user.email === String(sub.email || '').trim().toLowerCase());
      })).length;
      const deadline = Date.now() + 40_000;
      for (let offset = 0; offset < pending.length; offset += 10) {
        if (Date.now() >= deadline || Date.now() >= window.until) { failed += pending.length - offset; break; }
        const batch = pending.slice(offset, offset + 10);
        const results = await Promise.allSettled(batch.map(async sub => {
          if (!vapidPrivate || !vapidPublic) throw new Error('VAPID keys are not configured');
          return sendPush({ endpoint: sub.endpoint, p256dh: sub.p256DhKey || '', auth: sub.authKey || '' }, payload, vapidPrivate, vapidPublic);
        }));
        for (let index = 0; index < results.length; index++) {
          const result = results[index], sub = batch[index];
          if (result.status === 'fulfilled' && result.value >= 200 && result.value < 300) {
            sent++; delivered.add(keyOf(sub));
          } else if (result.status === 'fulfilled' && [404, 410].includes(result.value)) {
            // Gone subscriptions cannot receive another push. Other devices still can.
            skipped++; retired.add(keyOf(sub));
          } else failed++;
        }
        lease.checkpoint.delivered = [...delivered];
        lease.checkpoint.retired = [...retired];
        await lease.save();
      }
      if (!failed) await lease.complete(meeting.id, meeting.scheduledAt, definition.sentField, reminderHash([meeting.inviteeUserIds, meeting.invitees]));
      return { success: failed === 0, sent, failed, skipped, inAppRecipients: recipients.length,
        message: `Reminder published for ${recipients.length} participants. ${sent} device notifications accepted; ${failed} will be retried.` };
    } finally {
      await lease.save(true);
    }
}
