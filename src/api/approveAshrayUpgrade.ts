import { z } from 'zod';
import { createEndpoint, AshrayUpgradeRequests, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { migrateUserCourse } from '../lib/tagMangoEnroll';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Approve or reject an Ashray level upgrade request (two-step: approve→then pass/fail)',
  authenticated: true,
  inputSchema: z.object({
    requestId: z.string().optional(),
    logId: z.string().optional(),
    action: z.enum(['approve', 'reject', 'pass', 'fail']),
    reviewerNotes: z.string().optional(),
    userId: z.string().optional(),
    guideId: z.string().optional(),
    currentLevel: z.string().optional(),
    requestedLevel: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    const id = input.requestId || input.logId;
    if (!id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'requestId is required' });

    const request = await AshrayUpgradeRequests.findOne({ id });
    if (!request) throw new ZiteError({ code: 'NOT_FOUND', message: 'Request not found' });

    let newStatus: string;
    let shouldUpgradeUser = false;

    if (input.action === 'approve') {
      newStatus = 'APPROVED';
    } else if (input.action === 'pass') {
      newStatus = 'Passed';
      shouldUpgradeUser = true;
    } else if (input.action === 'fail') {
      newStatus = 'Failed';
    } else {
      newStatus = 'Failed';
    }

    await AshrayUpgradeRequests.update({
      id,
      record: {
        status: newStatus,
        reviewedBy: context.user!.email,
        reviewedAt: new Date().toISOString(),
        reason: input.reviewerNotes || '',
      },
    });

    let tagMangoMigration: any = undefined;
    const targetUserId = request.userId as string;
    let resolvedUserRecord: any = null;

    if (targetUserId) {
      resolvedUserRecord = await Users.findOne({ id: targetUserId, fields: ['id', 'ashrayLevel', 'fullName', 'email', 'phone', 'tagMangoEnrollmentStatus', 'tagMangoEnrollmentAttempts'] });
      if (!resolvedUserRecord) {
        resolvedUserRecord = await Users.findOne({
          filters: { userId: targetUserId },
          fields: ['id', 'ashrayLevel', 'fullName', 'email', 'phone', 'tagMangoEnrollmentStatus', 'tagMangoEnrollmentAttempts'],
        });
      }
    }

    if (shouldUpgradeUser && resolvedUserRecord) {
      const oldLevel = resolvedUserRecord.ashrayLevel || '';
      const newLevel = (request.requestedLevel || input.requestedLevel) as string;

      await Users.update({
        id: resolvedUserRecord.id,
        record: { ashrayLevel: newLevel },
      });

      // TagMango migration
      if (oldLevel && oldLevel !== newLevel && resolvedUserRecord.tagMangoEnrollmentStatus === 'Enrolled') {
        try {
          const result = await migrateUserCourse({
            userId: resolvedUserRecord.id,
            name: resolvedUserRecord.fullName || '',
            email: resolvedUserRecord.email || '',
            phone: resolvedUserRecord.phone || '',
            oldLevel,
            newLevel,
            currentAttempts: resolvedUserRecord.tagMangoEnrollmentAttempts || 0,
          });
          tagMangoMigration = {
            revokeResult: result.revokeResult,
            enrollResult: { status: result.enrollResult.status, error: result.enrollResult.error },
          };
        } catch {
          // Don't block response
        }
      }
    }

    if (resolvedUserRecord) {
      serverCacheInvalidate(`user_profile:${resolvedUserRecord.id}`);
    }

    return { success: true, message: `Request ${input.action}d successfully`, tagMangoMigration };
  },
});
