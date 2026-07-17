import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

export default createEndpoint({
  description: 'Guide toggles a user between resident and non-resident status — center-based access',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    makeResident: z.boolean(),
    residencyId: z.string().nullable().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isSuperGuide = role === 'Super Guide';
    const isAuthorized = ['Super Guide', 'Guide', 'BVSL', 'Sadhana Mentor'].includes(role);
    if (!isAuthorized) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });

    if (input.makeResident && !input.residencyId) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'A FOLK residency must be selected when making a user a resident' });
    }

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
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only update residency for users in your center' });
      }
    }

    const today = getTodayIST();

    await Users.update({
      id: input.userId,
      record: input.makeResident
        ? {
            residency: input.residencyId as string,
            residencyApproved: true,
            residencyClaimed: true,
            temporaryResidencyEnabled: false,
            residentSince: today,
            scholarSince: undefined,
          }
        : {
            residencyApproved: false,
            residencyClaimed: false,
            temporaryResidencyEnabled: false,
            residentSince: undefined,
            isFolkLead: false,
          },
    });

    return { success: true };
  },
});
