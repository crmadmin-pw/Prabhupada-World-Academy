import { z } from 'zod';
import { createEndpoint, PushSubscriptions, Users, SadhanaEntries, AppError } from '@/lib/backend-sdk';
import { storeBroadcast } from '@/lib/notificationBroadcast';
import getPwNotificationConfig from './getPwNotificationConfig';
import { isSadhanaReminderDue } from '@/lib/sadhanaReminderSchedule';
import { getNotificationDepartment, isSadhanaReminderEligibleUser } from '@/lib/notificationDepartment';
import { claimSadhanaReminderSlot } from '@/lib/sadhanaReminderDispatch';

/** Extract a plain string ID from a Firestore DocumentReference, array, or string. */
function getUserIdStr(userField: any): string | null {
  if (!userField) return null;
  if (typeof userField === 'string') return userField;
  if (Array.isArray(userField)) return getUserIdStr(userField[0]);
  if (userField.id) return String(userField.id);
  if (userField.path) {
    const segs = userField.path.split('/');
    return segs[segs.length - 1];
  }
  if (userField._path?.segments) {
    const segs = userField._path.segments;
    return segs[segs.length - 1];
  }
  return String(userField);
}

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function getSubscriptionUserKeys(sub: any): string[] {
  return [...new Set([
    getUserIdStr(sub?.user),
    sub?.userId,
    sub?.email,
    sub?.phone,
  ].filter(Boolean).map(String))];
}

function getUserAliasKeys(user: any): string[] {
  return [...new Set([
    user?.id,
    user?.userId,
    user?.email,
    user?.phone,
    user?.uid,
    user?.authUid,
    user?.firebaseUid,
    user?.firebaseUserId,
    user?.firebaseAuthUid,
  ].filter(Boolean).map(String))];
}

async function fetchUsersByKeys(keys: string[]): Promise<any[]> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const lookupFields = ['id', 'userId', 'email', 'phone', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid'];
  const results = new Map<string, any>();

  for (let i = 0; i < uniqueKeys.length; i += 30) {
    const chunk = uniqueKeys.slice(i, i + 30);
    await Promise.all(lookupFields.map(async field => {
      const { records } = await Users.findAll({
        filters: { [field]: { in: chunk } } as any,
        limit: 2000,
      }).catch(() => ({ records: [] }));
      for (const u of records) {
        if (u?.id || u?.userId || u?.email) results.set(u.id || u.userId || u.email, u);
      }
    }));
  }

  return [...results.values()];
}

async function fetchActiveUsers(): Promise<any[]> {
  const users: any[] = [];
  let offset = 0;
  while (true) {
    const page = await Users.findAll({
      filters: { status: 'Active' },
      fields: [
        'id', 'userId', 'email', 'phone', 'uid', 'authUid', 'firebaseUid',
        'firebaseUserId', 'firebaseAuthUid', 'status', 'segment', 'fullName',
        'isPrabhupadaWorldUser', 'isFolkUser', 'isFolkLead', 'residencyId',
        'role', 'isBvAdmin', 'isBvSuperAdmin',
      ],
      limit: 500,
      offset,
    });
    users.push(...page.records);
    if (!page.hasMore) break;
    offset += page.records.length;
  }
  return users;
}

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
  // RFC 5869 Extract: PRK = HMAC-SHA-256(salt, IKM)
  // IMPORTANT: salt is the HMAC *key*, IKM is the *data* — not the other way around.
  const saltForKey = salt.length ? salt : new Uint8Array(32);
  const saltKey = await crypto.subtle.importKey('raw', saltForKey.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm.buffer as ArrayBuffer));

  // RFC 5869 Expand: OKM = HMAC-SHA-256(PRK, info || 0x01)
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

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  // Import client's public key
  const clientKey = await crypto.subtle.importKey('raw', clientPublicKey.buffer as ArrayBuffer, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256));

  // Generate salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 section 3.4. The older aesgcm draft used different info
  // strings; mixing that derivation with aes128gcm makes Chrome reject it.
  const authInfo = concat(
    new TextEncoder().encode('WebPush: info\0'),
    clientPublicKey,
    localPublicKeyRaw,
  );
  const prkCombine = await hkdf(clientAuth, sharedSecret, authInfo, 32);

  // Key info
  const keyInfoBuf = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const contentKey = await hkdf(salt, prkCombine, keyInfoBuf, 16);

  // Nonce info
  const nonceInfoBuf = new TextEncoder().encode('Content-Encoding: nonce\0');
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

  const subject = process.env.VAPID_SUBJECT || 'mailto:notifications@example.invalid';
  const { token, publicKeyBytes } = await generateVapidJwt(audience, subject, vapidPrivate, vapidPublic);
  const { body } = await encryptPayload(sub.p256dh, sub.auth, payloadStr);

  const vapidPubB64 = base64UrlEncode(publicKeyBytes.buffer as ArrayBuffer);

  const resp = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': String(body.length),
      TTL: '86400',
      Urgency: 'high',
      Authorization: `vapid t=${token}, k=${vapidPubB64}`,
    },
    body: body.buffer as ArrayBuffer,
    // A stale browser subscription must not leave the admin's instant-send
    // button waiting forever after the in-app broadcast was already saved.
    signal: AbortSignal.timeout(8000),
  });

  const responseText = await resp.text().catch(() => '');
  console.log('[Push Send Debug]', {
    pushService: url.origin,
    status: resp.status,
    statusText: resp.statusText,
    responseText,
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
  public: true,
  webhook: {},
  inputSchema: z.object({
    checkDate: z.string().optional(),
    reminderSlot: z.enum(['night-1', 'night-2', 'morning']),
    cronSecret: z.string().min(16).max(256).optional(),
    customTitle: z.string().max(200).optional(),
    customBody: z.string().max(1000).optional(),
    senderEmail: z.string().email().max(320).optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
    scheduled: z.boolean().optional(),
  }),
  outputSchema: z.object({
    sent: z.number(),
    failed: z.number(),
    skipped: z.number(),
    inAppRecipients: z.number(),
  }),
  execute: async ({ input, context }: any) => {
    // Validate a server-only cron secret or an active user with notification authority.
    const validCronSecrets = [
      process.env.APP_CRON_SECRET,
      process.env.ZITE_CRON_SECRET,
    ].filter(Boolean);
    const isCron = input.cronSecret && validCronSecrets.includes(input.cronSecret);
    const canSendNotifications = !!(
      context?.user?.isActive &&
      (context.user.capabilities?.includes('*') || context.user.capabilities?.includes('notifications.send'))
    );
    if (!isCron && !canSendNotifications) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized to send push notifications' });
    }

    if (input.scheduled && !isCron) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Scheduled notifications require the server scheduler' });
    }
    if (input.scheduled && !input.segment) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Scheduled notifications require a department' });
    }

    // Segment comes from validated input or the trusted database-backed user context.
    // Never infer authority or scope from email substrings.
    const targetSegment: 'PW' | 'FOLK' = input.segment || context?.user?.segment || 'PW';
    const callerSegment = String(context?.user?.segment || '').trim().toUpperCase();
    const canManageAnyDepartment = context?.user?.capabilities?.includes('*');
    if (!isCron && !canManageAnyDepartment && callerSegment && callerSegment !== targetSegment) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You cannot notify another department' });
    }

    // A server scheduler can call every minute; each department's saved admin
    // schedule determines whether to send. Manual dispatch remains immediate.
    const scheduleConfig = input.scheduled
      ? await getPwNotificationConfig.execute({ input: { segment: targetSegment }, context: {} } as never)
      : null;
    if (scheduleConfig && !isSadhanaReminderDue(scheduleConfig)) {
      return { sent: 0, failed: 0, skipped: 0, inAppRecipients: 0 };
    }

    // Determine the date to check
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    if (input.reminderSlot === 'morning') istNow.setUTCDate(istNow.getUTCDate() - 1);
    const checkDate = input.checkDate || istNow.toISOString().slice(0, 10);

    const senderId = context?.user?.id;
    const senderEmail = String(context?.user?.email || (isCron ? input.senderEmail : '') || '').toLowerCase();

    const slotMsg = SLOT_MESSAGES[input.reminderSlot] || SLOT_MESSAGES['night-1'];
    const title = scheduleConfig?.title || input.customTitle || slotMsg.title;
    const body = scheduleConfig?.body || input.customBody || slotMsg.body;
    const scheduleSlot = istNow.toISOString().slice(0, 16);
    const broadcastId = input.scheduled
      ? `sadhana-${targetSegment}-${scheduleSlot}`
      : String(Date.now()) + '_' + String(Math.floor(Math.random() * 1000000));

    // Get all push subscriptions
    const { records: subs } = await PushSubscriptions.findAll({ limit: 2000 });

    const allSubscriptionUserKeys = subs.flatMap(getSubscriptionUserKeys);
    const userRecords = await fetchUsersByKeys(allSubscriptionUserKeys);
    const userByAlias = new Map<string, any>();
    for (const user of userRecords) {
      for (const key of getUserAliasKeys(user)) {
        userByAlias.set(normalizeKey(key), user);
      }
    }

    const resolveSubscriptionUser = (sub: any): any | null => {
      for (const key of getSubscriptionUserKeys(sub)) {
        const user = userByAlias.get(normalizeKey(key));
        if (user) return user;
      }
      return null;
    };

    // Check who submitted sadhana for checkDate
    const entries: any[] = [];
    let entryOffset = 0;
    while (true) {
      const page = await SadhanaEntries.findAll({
        filters: { entryDate: checkDate },
        fields: ['user'],
        limit: 500,
        offset: entryOffset,
      });
      entries.push(...page.records);
      if (!page.hasMore) break;
      entryOffset += page.records.length;
    }

    // Use getUserIdStr to extract plain string IDs from sadhana entry references
    const submittedUserIds = new Set(
      entries.map(e => normalizeKey(getUserIdStr(e.user))).filter(Boolean) as string[]
    );

    const isTargetUser = (u: any): boolean => {
      if (!u || u.status !== 'Active') return false;
      if (!isSadhanaReminderEligibleUser(u)) return false;
      const isSender = (senderId && u.id === senderId) ||
                       (senderEmail && (u.email || '').toLowerCase() === senderEmail);
      if (isSender) return false;

      return getNotificationDepartment(u) === targetSegment;
    };

    const hasSubmitted = (user: any): boolean => {
      return getUserAliasKeys(user).some(key => submittedUserIds.has(normalizeKey(key)));
    };

    // In-app delivery must not depend on native-push consent. Every active,
    // in-scope member who has not submitted receives the scoped long-poll
    // broadcast; only the subset with a device subscription receives Web Push.
    const eligibleRecipients = (await fetchActiveUsers()).filter(user =>
      isTargetUser(user) && !hasSubmitted(user)
    );
    const eligibleRecipientIds = new Set(eligibleRecipients.map(user => String(user.id)));

    const payloadStr = JSON.stringify({
      id: broadcastId,
      title,
      body,
      slot: input.reminderSlot,
      url: '/sadhana',
      senderEmail,
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const vapidPrivate =
      process.env.APP_VAPID_PRIVATE_KEY ||
      process.env.ZITE_VAPID_PRIVATE_KEY ||
      process.env.VAPID_PRIVATE_KEY;
    const vapidPublic =
      process.env.APP_VAPID_PUBLIC_KEY ||
      process.env.ZITE_VAPID_PUBLIC_KEY ||
      process.env.VAPID_PUBLIC_KEY ||
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    const seenEndpoints = new Set<string>();
    const toSend = subs.filter((sub: any) => {
      const endpoint = String(sub.endpoint || '').trim();
      if (!endpoint || seenEndpoints.has(endpoint)) { skipped++; return false; }
      seenEndpoints.add(endpoint);

      const user = resolveSubscriptionUser(sub);
      if (!isTargetUser(user)) { skipped++; return false; }
      // Sadhana completion is an unconditional exclusion. No caller, including
      // an administrator using instant dispatch, may bypass this guard.
      if (hasSubmitted(user)) { skipped++; return false; }
      if (!eligibleRecipientIds.has(String(user.id))) { skipped++; return false; }
      return true;
    });

    // Scope the long-poll broadcast to every missing member, whether or not
    // they have opted into browser push. This is the in-app notification path.
    if (input.scheduled && !await claimSadhanaReminderSlot(targetSegment, scheduleSlot)) {
      return { sent: 0, failed: 0, skipped: toSend.length, inAppRecipients: 0 };
    }
    let inAppRecipients = 0;
    if (eligibleRecipients.length > 0) {
      const eligibleIds = new Set<string>();
      const eligibleEmails = new Set<string>();
      for (const user of eligibleRecipients) {
        for (const alias of getUserAliasKeys(user)) {
          if (alias.includes('@')) eligibleEmails.add(alias.toLowerCase());
          else eligibleIds.add(alias);
        }
      }

      try {
        inAppRecipients = await storeBroadcast(
          title,
          body,
          input.reminderSlot || 'night-1',
          senderEmail || undefined,
          broadcastId,
          [...eligibleIds],
          '/sadhana',
          [...eligibleEmails],
          targetSegment,
        );
      } catch (e) {
        console.warn('[Push] Store broadcast failed:', e);
        throw new AppError({ code: 'INTERNAL_ERROR', message: 'The in-app reminder could not be published' });
      }
    }

    // In-app broadcasts remain useful even if a deployment is missing VAPID
    // credentials. Report native delivery failures without discarding them.
    if (!vapidPrivate || !vapidPublic) {
      if (toSend.length > 0) {
        console.error('[Push] Web Push credentials are not configured');
        return { sent: 0, failed: toSend.length, skipped, inAppRecipients };
      }
      return { sent: 0, failed: 0, skipped, inAppRecipients };
    }

    const batchSize = 10;
    for (let i = 0; i < toSend.length; i += batchSize) {
      const batch = toSend.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (sub) => {
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

    return { sent, failed, skipped, inAppRecipients };
  },
});
