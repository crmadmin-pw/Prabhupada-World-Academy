import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Mark or unmark a user as having completed their TagMango course (Guide/Super Guide only)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    completed: z.boolean(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    courseCompleted: z.boolean(),
    courseCompletedAt: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role || 'User';
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide or Super Guide access required' });
    }

    // Verify the target user exists
    const target = await Users.findOne({
      id: input.userId,
      fields: ['id', 'fullName', 'tagMangoEnrollmentStatus', 'courseCompleted', 'residency', 'guide'],
    });
    if (!target) {
      throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    // For non-super guides, verify scope
    if (role !== 'Super Guide') {
      const scope = await getGuideScope(context.user.email);
      if (!scope) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'No guide scope found' });
      }
      const inScope = isUserInGuideScope(scope, { residency: target.residency, guide: target.guide });
      if (!inScope) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'User is not in your scope' });
      }
    }

    const now = new Date().toISOString();
    const updateFields: Record<string, any> = {
      courseCompleted: input.completed,
      courseCompletedAt: input.completed ? now : null,
    };

    await Users.update({ id: input.userId, record: updateFields });

    return {
      success: true,
      courseCompleted: input.completed,
      courseCompletedAt: input.completed ? now : null,
    };
  },
});
