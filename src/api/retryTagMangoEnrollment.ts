import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { enrollUserOnTagMango } from '../lib/tagMangoEnroll';

export default createEndpoint({
  description: 'Retry TagMango enrollment for a user whose enrollment failed (Guide/Super Guide only)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    enrollmentStatus: z.enum(['Enrolled', 'Failed', 'Skipped']),
    error: z.string().optional(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });

    const role = context.user.role;
    if (role !== 'Guide' && role !== 'Super Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can retry enrollment' });
    }

    const user = await Users.findOne({
      id: input.userId,
      fields: ['id', 'fullName', 'email', 'phone', 'ashrayLevel', 'tagMangoEnrollmentAttempts'],
    });

    if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const result = await enrollUserOnTagMango({
      userId: user.id,
      name: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      ashrayLevel: user.ashrayLevel,
      currentAttempts: user.tagMangoEnrollmentAttempts || 0,
    });

    return {
      success: result.status === 'Enrolled',
      enrollmentStatus: result.status,
      error: result.error,
    };
  },
});
