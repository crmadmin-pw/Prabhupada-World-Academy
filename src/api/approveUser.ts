import { z } from 'zod';
import { createEndpoint, Users, ZiteError, Email } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { enrollUserOnTagMango } from '../lib/tagMangoEnroll';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Approve a user (Guide/Super Guide only) — center-based access',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    residencyApproved: z.boolean().optional(),
    guideId: z.string().optional(),
    selectedFolkResidency: z.string().optional(),
    ashrayLevel: z.string().optional(),
    newGuideId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    enrollmentStatus: z.enum(['Enrolled', 'Failed', 'Skipped']).optional(),
    enrollmentError: z.string().optional(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';

    // Fetch user record (needed for both auth check and email notification)
    const userRecord = await Users.findOne({
      id: input.userId,
      fields: ['id', 'email', 'fullName', 'residency', 'guide', 'phone', 'ashrayLevel', 'tagMangoEnrollmentAttempts'],
    });
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    // Authorization: regular guides can only approve users in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only approve users in your center' });
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

    // CRITICAL: Approval MUST succeed first, before any enrollment attempt
    await Users.update({ id: input.userId, record: updates });
    serverCacheInvalidate(profileCacheKey(input.userId));

    // Email: approval confirmation to the devotee
    try {
      if (userRecord?.email) {
        const appUrl = process.env.ZITE_APP_URL ?? '';
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

    // TagMango enrollment — NEVER blocks approval
    let enrollmentStatus: 'Enrolled' | 'Failed' | 'Skipped' = 'Skipped';
    let enrollmentError: string | undefined;

    try {
      const effectiveAshray = input.ashrayLevel || (userRecord.ashrayLevel as string | undefined);
      const result = await enrollUserOnTagMango({
        userId: input.userId,
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

    return { success: true, enrollmentStatus, enrollmentError };
  },
});
