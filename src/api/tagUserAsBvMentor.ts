import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Tag/untag a user as BV Mentor and assign their guide — Guide or Super Guide',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
    guideId: z.string().optional(), // Guides table record UUID (Super Guide only)
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isSuperGuide = role === 'Super Guide';
    const isGuide = role === 'Guide';
    if (!isSuperGuide && !isGuide) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide or Super Guide access required' });
    }

    const userRecord = await Users.findOne({ id: input.userId, fields: ['id'] });
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const shouldTag = input.action === 'tag';
    const updateData: Record<string, any> = { isBvMentor: shouldTag };
    if (shouldTag) {
      // Guides automatically assign themselves; Super Guides can pass an explicit guideId
      updateData.bvMentorGuideId = isGuide ? context.user.id : (input.guideId || context.user.id);
    } else {
      updateData.bvMentorGuideId = '';
    }

    await Users.update({ id: userRecord.id, record: updateData });

    // Bust the profile cache so the user sees their new role on next load
    serverCacheInvalidate(profileCacheKey(input.userId));

    return { success: true };
  },
});
