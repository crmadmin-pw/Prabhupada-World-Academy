import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, Email, ZiteError } from 'zite-integrations-backend-sdk';
import { generateUniqueUserId } from '../lib/userIdGen';
import { enforceRateLimit } from '../utils/rateLimit';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Register new user — updates the user sync record with profile data. Phone is primary identifier.',
  authenticated: true,
  inputSchema: z.object({
    fullName: z.string().min(1).max(200).transform(s => s.trim()),
    phoneCountryCode: z.string().max(5),
    phone: z.string().min(7).max(20),
    phoneE164: z.string().max(25),
    email: z.string().max(320).optional(),
    guideId: z.string().min(1).max(100),
    residencyUserClaim: z.boolean(),
    selectedFolkResidency: z.string().max(100).optional(),
    residencyJoinDate: z.string().max(20).optional(),
    ashrayLevel: z.string().max(50).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    userId: z.string(),
    status: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    // Rate limit: max 5 registration attempts per user per 10 minutes
    enforceRateLimit(`register:${context.user.id}`, 5, 10 * 60 * 1000);

    // Verify guide exists (guideId is the UUID of the Guides record)
    const guideRecord = await Guides.findOne({ id: input.guideId });
    if (!guideRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'Selected guide not found' });

    // Verify residency if claimed
    let residencyRecordId: string | undefined;
    if (input.selectedFolkResidency) {
      const residencyRecord = await FolkResidencies.findOne({ id: input.selectedFolkResidency });
      if (!residencyRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'Residency not found' });
      residencyRecordId = residencyRecord.id;
    }

    // Check if this phone is already registered (by another user)
    const phone = input.phoneE164.replace(/[^0-9]/g, '');
    const { records: existing } = await Users.findAll({ filters: { phone }, limit: 5 });
    const dupUser = existing.find(u => u.id !== context.user.id && u.userId);
    if (dupUser) {
      // Return generic success to prevent enumeration
      return { success: true, userId: '', status: 'PENDING_APPROVAL' };
    }

    // ── Guard against bare user-sync records re-registering over a real profile ──
    // If user-sync created a bare record (case-mismatch), the real profile may already
    // exist under a different email case. Detect and merge instead of overwriting with
    // incomplete data.
    const existingRecord = await Users.findOne({ id: context.user.id, fields: ['id', 'userId', 'status', 'email'] });
    let userId = existingRecord?.userId ? String(existingRecord.userId) : '';

    // If THIS record has no userId but another record with the same email (case-insensitive) does,
    // that means a real profile exists — we should merge it rather than start a fresh registration.
    if (!userId) {
      const authEmailLower = (context.user.email || '').toLowerCase();
      const { records: allRecords } = await Users.findAll({
        fields: ['id', 'userId', 'status', 'email'],
        limit: 200,
      });
      const realProfile = allRecords.find(r =>
        r.id !== context.user.id &&
        r.userId &&
        r.status &&
        (r.email || '').toLowerCase() === authEmailLower,
      );
      if (realProfile) {
        // Real profile exists — don't create a duplicate. Just re-link.
        userId = String(realProfile.userId);
      }
    }

    if (!userId || !/^USER-\d+$/.test(userId)) {
      // Generate a race-condition-proof unique USER-XXX ID
      userId = await generateUniqueUserId('USER');
    }

    // Always normalize email to lowercase — prevents case-mismatch duplicates on future logins
    // (Google/OAuth providers return lowercase, so stored email must match)
    const userEmail = (input.email || context.user.email || '').toLowerCase();
    const appUrl = process.env.ZITE_APP_URL ?? '';
    const ashrayLevel = input.ashrayLevel || 'Jigyasa';

    // Upsert the record in Firestore — single source of truth for all environments
    const firestoreRecord = {
      id: context.user.id,
      userId,
      fullName: input.fullName,
      phone,
      email: userEmail,
      guide: guideRecord.id,
      residency: residencyRecordId || null,
      role: 'User',
      status: 'Pending Approval',
      residencyClaimed: input.residencyUserClaim,
      residencyApproved: false,
      residencyJoinDate: input.residencyJoinDate || null,
      ashrayLevel,
      bvServiceAllocated: false,
      createdAt: new Date().toISOString()
    };
    const existingFirestoreUser = await Users.findOne({ id: context.user.id });
    if (!existingFirestoreUser) {
      await Users.create({ record: firestoreRecord });
    } else {
      await Users.update({ id: context.user.id, record: firestoreRecord });
    }


    // ── Email: confirmation to the newly registered devotee ──
    try {
      await Email.send({
        to: userEmail,
        subject: '🙏 Registration Received — Awaiting Guide Approval | FOLK Sadhana Tracker',
        body: [
          {
            type: 'text',
            content: `Hare Krishna, ${input.fullName}!\n\nYour registration has been received successfully. 🙏\n\nYour assigned Folk Guide — <strong>${guideRecord.fullName ?? 'your guide'}</strong> — has been notified and will review your registration shortly.\n\nYou will receive another email as soon as your account is approved and you can start entering your daily Sadhana.`,
          },
          { type: 'divider' },
          {
            type: 'text',
            content: `<strong>What happens next?</strong>\n• Your Folk Guide will review your registration\n• Once approved, you will receive a confirmation email\n• You can then start filling your Sadhana every day before sleeping\n\nHare Krishna!`,
          },
        ],
      });
    } catch {
      // Email failure must not block registration
    }

    // ── Email: notification to the assigned guide ──
    try {
      if (guideRecord.email) {
        await Email.send({
          to: guideRecord.email,
          subject: `New Devotee Awaiting Approval — ${input.fullName} | FOLK Sadhana Tracker`,
          body: [
            {
              type: 'text',
              content: `Hare Krishna,\n\nA new devotee has registered under your guidance and is awaiting your approval.\n\n<strong>Name:</strong> ${input.fullName}\n<strong>Phone:</strong> ${input.phoneE164}\n<strong>Ashray Level:</strong> ${ashrayLevel}${input.residencyUserClaim ? '\n<strong>Residency Claim:</strong> Yes' : ''}\n\nPlease click the button below to go directly to the Approvals tab and review this registration.`,
            },
            {
              type: 'button',
              label: 'Review & Approve →',
              href: `${appUrl}/guide/dashboard`,
              alignment: 'center',
            },
            {
              type: 'text',
              content: `Hare Krishna!`,
            },
          ],
        });
      }
    } catch {
      // Email failure must not block registration
    }

    serverCacheInvalidate(profileCacheKey(context.user.id));
    return { success: true, userId, status: 'PENDING_APPROVAL' };
  },
});
