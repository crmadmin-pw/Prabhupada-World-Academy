import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Tag/untag a user as B — center-based access for Guide/Super Guide',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    isB: z.boolean(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const isSuperGuide = callerRole === 'Super Guide';
    const isAuthorized = isSuperGuide || callerRole === 'Guide' || callerRole === 'BVSL';
    if (!isAuthorized) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });

    let userRecord = await Users.findOne({
      id: input.userId,
      fields: ['id', 'residency', 'guide'],
    });
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: `User ${input.userId} not found` });

    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only tag users in your center' });
      }
    }

    await Users.update({ id: userRecord.id, record: { isB: input.isB } });
    return { success: true };
  },
});
