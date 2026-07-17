import { z } from 'zod';
import { createEndpoint, Users, Guides, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Reassign a user to a different guide — Super Guides can do this for anyone; regular guides can do this for users in their center',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    newGuideId: z.string().optional(),
    guideId: z.string().optional(), // legacy alias for newGuideId
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const isGuide = context.user.role === 'Guide';

    if (!isSuperGuide && !isGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    // Regular guides can only reassign users in their center
    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });

      const userRecord = await Users.findOne({
        id: input.userId,
        fields: ['id', 'residency', 'guide'],
      });
      if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only reassign users in your center' });
      }
    }

    const targetGuideId = input.newGuideId || input.guideId || '';
    const newGuide = await Guides.findOne({ id: targetGuideId });
    if (!newGuide) throw new ZiteError({ code: 'NOT_FOUND', message: 'Guide not found' });

    await Users.update({ id: input.userId, record: { guide: newGuide.id } });
    serverCacheInvalidate('user_profile:' + input.userId);
    return { success: true };
  },
});
