import { z } from 'zod';
import { createEndpoint, PushSubscriptions, Users, SadhanaEntries, ZiteError } from 'zite-integrations-backend-sdk';

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

  // Import the VAPID private key
  const rawPrivKey = base64UrlDecode(privateKeyBase64);
  const jwk = {
    kty: 'EC' as const,
    crv: 'P-256' as const,
    x: base64UrlEncode(rawPrivKey.slice(0, 32).buffer),
    y: '', // filled below
    d: base64UrlEncode(rawPrivKey.buffer as ArrayBuffer),
  };

  // Derive public key X and Y from the raw public key (65 bytes uncompressed)
  const rawPubKey = base64UrlDecode(publicKeyBase64);
  jwk.x = base64UrlEncode(rawPubKey.slice(1, 33).buffer as ArrayBuffer);
  jwk.y = base64UrlEncode(rawPubKey.slice(33, 65).buffer as ArrayBuffer);

  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    signingKey,
    new TextEncoder().encode(unsignedToken),
  );

  // Convert DER signature to raw r||s (64 bytes)
  const sigBytes = new Uint8Array(sig);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32);
  } else {
    // Already raw r||s from Web Crypto
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
  const key = await crypto.subtle.importKey('raw', ikm.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const saltBuf = salt.length ? (salt.buffer as ArrayBuffer) : new ArrayBuffer(32);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, saltBuf));
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

async function encryptPayload(
  p256dhKey: string,
  authSecret: string,
  payload: string,
): Promise<{ body: Uint8Array; salt: Uint8Array; localPublicKey: Uint8Array }> {
  const clientPublicKey = base64UrlDecode(p256dhKey);
  const clientAuth = base64UrlDecode(authSecret);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  // Import client's public key
  const clientKey = await crypto.subtle.importKey('raw', clientPublicKey.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256));

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Create info params for HKDF per RFC 8291
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const prkCombine = await hkdf(clientAuth, sharedSecret, authInfo, 32);

  // Key info
  const keyInfoBuf = concat(
    new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    new Uint8Array([0, 65]),
    clientPublicKey,
    new Uint8Array([0, 65]),
    localPublicKeyRaw,
  );
  const contentKey = await hkdf(salt, prkCombine, keyInfoBuf, 16);

  // Nonce info
  const nonceInfoBuf = concat(
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    new Uint8Array([0, 65]),
    clientPublicKey,
    new Uint8Array([0, 65]),
    localPublicKeyRaw,
  );
  const nonce = await hkdf(salt, prkCombine, nonceInfoBuf, 12);

  // Encrypt with AES-128-GCM
  const paddedPayload = concat(new TextEncoder().encode(payload), new Uint8Array([2])); // delimiter byte
  const aesKey = await crypto.subtle.importKey('raw', contentKey.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce.buffer as ArrayBuffer }, aesKey, paddedPayload.buffer as ArrayBuffer));

  // Build aes128gcm body: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted
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
): Promise<boolean> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const { token, publicKeyBytes } = await generateVapidJwt(audience, 'mailto:admin@folkresidency.com', vapidPrivate, vapidPublic);
  const { body } = await encryptPayload(sub.p256dh, sub.auth, payloadStr);

  const vapidPubB64 = base64UrlEncode(publicKeyBytes.buffer as ArrayBuffer);

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: '86400',
      Authorization: `vapid t=${token}, k=${vapidPubB64}`,
    },
    body: body.buffer as ArrayBuffer,
  });

  return resp.status >= 200 && resp.status < 300;
}

// ── Slot messages ──
const SLOT_MESSAGES: Record<string, { title: string; body: string }> = {
  'night-1': { title: '📿 Sadhana Reminder', body: 'Time to fill your Sadhana! Complete it before sleeping tonight.' },
  'night-2': { title: '🙏 Sadhana Reminder', body: "Don't forget — fill your Sadhana report before you sleep!" },
  'morning': { title: '⏰ Last Chance!', body: "Submit yesterday's Sadhana before the morning deadline!" },
};

export default createEndpoint({
  description: 'Send push notifications to users who have not submitted sadhana',
  authenticated: false,
  webhook: {},
  inputSchema: z.object({
    checkDate: z.string().optional(),
    reminderSlot: z.enum(['night-1', 'night-2', 'morning']),
    cronSecret: z.string().optional(),
  }),
  outputSchema: z.object({
    sent: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),
  execute: async ({ input }) => {
    // Validate cron secret
    if (input.cronSecret !== process.env.ZITE_CRON_SECRET) {
      throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Invalid cron secret' });
    }

    // Determine the date to check
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const checkDate = input.checkDate || istNow.toISOString().slice(0, 10);

    // Get all push subscriptions
    const { records: subs } = await PushSubscriptions.findAll({ limit: 2000 });
    if (subs.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    // Get unique user IDs from subscriptions
    const subsByUser = new Map<string, typeof subs[0]>();
    for (const sub of subs) {
      const uid = Array.isArray(sub.user) ? sub.user[0] : sub.user;
      if (uid) subsByUser.set(uid, sub);
    }

    // Check who submitted sadhana for checkDate
    const userIds = [...subsByUser.keys()];
    const { records: entries } = await SadhanaEntries.findAll({
      filters: { entryDate: checkDate, user: { in: userIds } },
      fields: ['user'],
      limit: 2000,
    });

    const submittedUserIds = new Set(
      entries.map(e => (Array.isArray(e.user) ? e.user[0] : e.user)).filter(Boolean)
    );

    // Also check only active users
    const { records: activeUsers } = await Users.findAll({
      filters: { id: { in: userIds }, status: 'Active' },
      fields: ['id'],
      limit: 2000,
    });
    const activeUserIds = new Set(activeUsers.map(u => u.id));

    const slotMsg = SLOT_MESSAGES[input.reminderSlot] || SLOT_MESSAGES['night-1'];
    const payloadStr = JSON.stringify({
      title: slotMsg.title,
      body: slotMsg.body,
      slot: input.reminderSlot,
      url: '/sadhana',
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const vapidPrivate = process.env.ZITE_VAPID_PRIVATE_KEY;
    const vapidPublic = process.env.ZITE_VAPID_PUBLIC_KEY;

    // Send in parallel batches of 10
    const toSend = [...subsByUser.entries()].filter(([uid]) => {
      if (submittedUserIds.has(uid)) { skipped++; return false; }
      if (!activeUserIds.has(uid)) { skipped++; return false; }
      return true;
    });

    const batchSize = 10;
    for (let i = 0; i < toSend.length; i += batchSize) {
      const batch = toSend.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async ([, sub]) => {
          const ok = await sendPush(
            { endpoint: sub.endpoint || '', p256dh: sub.p256DhKey || '', auth: sub.authKey || '' },
            payloadStr,
            vapidPrivate,
            vapidPublic,
          );
          return ok;
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) sent++;
        else failed++;
      }
    }

    return { sent, failed, skipped };
  },
});
