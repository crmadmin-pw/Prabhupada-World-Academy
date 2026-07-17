import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Guide assigns or removes scholar (temporary FOLK residency) status — center-based access',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    enabled: z.boolean(),
    residencyId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const isSuperGuide = callerRole === 'Super Guide';
    const isAuthorized = isSuperGuide || callerRole === 'Guide' || callerRole === 'BVSL';
    if (!isAuthorized) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });

    // Regular guides: verify user is in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });

      const userRecord = await Users.findOne({
        id: input.userId,
        fields: ['id', 'residency', 'guide'],
      });
      if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only change scholar status for users in your center' });
      }
    }

    const today = getTodayIST();
    await Users.update({
      id: input.userId,
      record: {
        temporaryResidencyEnabled: input.enabled,
        temporaryResidency: (input.enabled && input.residencyId) ? input.residencyId : undefined,
        scholarSince: input.enabled ? today : undefined,
      },
    });
    return { success: true };
  },
});
