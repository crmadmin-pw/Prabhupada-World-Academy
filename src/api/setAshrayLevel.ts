import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { migrateUserCourse } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Directly set a user ashray level — for Guides and Super Guides only',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    ashrayLevel: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    tagMangoMigration: z.object({
      revokeResult: z.string(),
      enrollResult: z.object({
        status: z.string(),
        error: z.string().optional(),
      }),
    }).optional(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role || '';
    const isSuperGuide = role === 'Super Guide';
    const guideScope = await getGuideScope(context.user.email);
    const isGuide = !!guideScope;

    if (!isSuperGuide && !isGuide) {
      throw new Error('Only Guides and Super Guides can set ashray levels');
    }

    let target = await Users.findOne({ id: input.userId, fields: ['id', 'residency', 'guide', 'ashrayLevel', 'fullName', 'email', 'phone', 'tagMangoEnrollmentStatus', 'tagMangoEnrollmentAttempts'] }).catch(() => undefined);
    if (!target) {
      target = await Users.findOne({ filters: { userId: input.userId }, fields: ['id', 'residency', 'guide', 'ashrayLevel', 'fullName', 'email', 'phone', 'tagMangoEnrollmentStatus', 'tagMangoEnrollmentAttempts'] });
    }
    if (!target) throw new Error('User not found');

    if (!isSuperGuide && guideScope && !isUserInGuideScope(guideScope, target)) {
      throw new Error('User is not in your guide scope');
    }

    const oldLevel = target.ashrayLevel || '';
    const newLevel = input.ashrayLevel;

    await Users.update({ id: target.id, record: { ashrayLevel: newLevel } });

    // TagMango migration if level changed and user was enrolled
    let tagMangoMigration: any = undefined;
    if (oldLevel && oldLevel !== newLevel && target.tagMangoEnrollmentStatus === 'Enrolled') {
      try {
        const result = await migrateUserCourse({
          userId: target.id,
          name: target.fullName || '',
          email: target.email || '',
          phone: target.phone || '',
          oldLevel,
          newLevel,
          currentAttempts: target.tagMangoEnrollmentAttempts || 0,
        });
        tagMangoMigration = {
          revokeResult: result.revokeResult,
          enrollResult: { status: result.enrollResult.status, error: result.enrollResult.error },
        };
      } catch {
        // Don't block the response for migration failures
      }
    }

    return { success: true, tagMangoMigration };
  },
});
