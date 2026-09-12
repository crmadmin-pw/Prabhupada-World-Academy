import { z } from 'zod';
import { createEndpoint, Users, AppError, Email } from '@/lib/backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { enrollUserOnTagMango } from '../lib/tagMangoEnroll';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Approve a user (Guide/Super Guide only) — center-based access',
  authenticated: true,
  requiredCapabilities: 'users.approve',
  inputSchema: z.object({
    userId: z.string(),
    residencyApproved: z.boolean().optional(),
    guideId: z.string().optional(),
    selectedFolkResidency: z.string().optional(),
    ashrayLevel: z.string().optional(),
    newGuideId: z.string().optional(),
    sadhanaMentorId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    enrollmentStatus: z.enum(['Enrolled', 'Conflict', 'Failed', 'Skipped']).optional(),
    enrollmentError: z.string().optional(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');

    // Fetch user record (needed for both auth check and email notification)
    const userFields = ['id', 'userId', 'email', 'fullName', 'residency', 'guide', 'phone', 'ashrayLevel', 'tagMangoEnrollmentAttempts', 'segment', 'isPrabhupadaWorldUser'];
    // Approval lists expose the stable public userId, while migrated records
    // may be referenced by the Firestore document ID or email.
    const userRecord = await Users.findOne({ id: input.userId, fields: userFields }) ||
      await Users.findOne({ filters: { userId: input.userId }, fields: userFields }) ||
      await Users.findOne({ filters: { email: input.userId }, fields: userFields }) ||
      await Users.findOne({ filters: { email: String(input.userId).toLowerCase() }, fields: userFields });
    if (!userRecord) throw new AppError({ code: 'NOT_FOUND', message: 'User not found' });

    const normalizedRole = String(context.user.normalizedRole || context.user.role || '')
      .trim()
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
    const isSuperGuide = normalizedRole === 'SUPER_GUIDE';
    const isPwUser = userRecord.segment === 'PW' || !!userRecord.isPrabhupadaWorldUser;
    const isPwAdmin = !!(
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      normalizedRole === 'SUPER_ADMIN' ||
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'PW_ADMIN'
    );
    const canApprovePwUser = isPwUser && (
      context.user.isBvSuperAdmin ||
      (isPwAdmin && String(context.user.segment || '').toUpperCase() === 'PW')
    );

    // PW administrators approve PW registrations directly.  Other approvers
    // remain limited to their established FOLK guide scope.
    if (!isSuperGuide && !canApprovePwUser) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new AppError({ code: 'FORBIDDEN', message: 'Guide access required' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'You can only approve users in your center' });
      }
    }

    const today = getTodayIST();
    const updates: any = {
      status: 'Active',
      residencyApproved: input.residencyApproved ?? false,
      statusChangedAt: today,
    };
    if (input.ashrayLevel) updates.ashrayLevel = input.ashrayLevel;
    if (input.newGuideId) updates.guide = input.newGuideId;
    if (input.selectedFolkResidency) {
      updates.residency = input.selectedFolkResidency;
      if (input.residencyApproved) updates.residentSince = today;
    }
    if (input.sadhanaMentorId) {
      updates.sadhanaMentor = input.sadhanaMentorId;
    }

    // CRITICAL: Approval MUST succeed first, before any enrollment attempt
    await Users.update({ id: userRecord.id, record: updates });
    serverCacheInvalidate(profileCacheKey(userRecord.id));

    // Email: approval confirmation to the devotee
    try {
      if (userRecord?.email) {
        const appUrl = process.env.APP_APP_URL ?? '';
        await Email.send({
          to: userRecord.email as string,
          subject: '✅ You Are Approved! Start Your Sadhana Today | FOLK Sadhana Tracker',
          body: [
            {
              type: 'text',
              content: `Hare Krishna, ${userRecord.fullName ?? 'Prabhu'}!\n\nWe are happy to inform you that your registration has been <strong>approved</strong> by your Folk Guide. 🙏\n\nYou can now start entering your daily Sadhana. Please make it a habit to fill it every night before you sleep.`,
            },
            {
              type: 'button',
              label: '📿 Fill My Sadhana Now →',
              href: `${appUrl}/sadhana`,
            },
            { type: 'divider' },
            {
              type: 'text',
              content: `<strong>A gentle reminder:</strong>\nConsistent Sadhana practice is the foundation of our spiritual progress. Your Guide and fellow devotees are cheering for you!\n\n• Fill your Sadhana every day before sleeping\n• Track your progress on your dashboard\n• Reach out to your Folk Guide if you need support\n\nHare Krishna! 🙏`,
            },
          ],
        });
      }
    } catch {
      // Email failure must not block approval
    }

    // TagMango enrollment — NEVER blocks approval, and skip for PW users
    let enrollmentStatus: 'Enrolled' | 'Conflict' | 'Failed' | 'Skipped' = 'Skipped';
    let enrollmentError: string | undefined;

    if (!isPwUser) {
      try {
        const effectiveAshray = input.ashrayLevel || (userRecord.ashrayLevel as string | undefined);
        const result = await enrollUserOnTagMango({
          userId: userRecord.id,
          name: userRecord.fullName || '',
          email: userRecord.email || '',
          phone: userRecord.phone || '',
          ashrayLevel: effectiveAshray,
          currentAttempts: userRecord.tagMangoEnrollmentAttempts || 0,
        });
        enrollmentStatus = result.status;
        enrollmentError = result.error;
      } catch (err: any) {
        enrollmentStatus = 'Failed';
        enrollmentError = err?.message || 'Unexpected enrollment error';
      }
    }

    return { success: true, enrollmentStatus, enrollmentError };
  },
});
