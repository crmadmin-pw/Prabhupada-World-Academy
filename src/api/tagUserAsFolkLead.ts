import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Tag/untag a user as FOLK Lead',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const isSuperGuide = callerRole === 'Super Guide';
    if (!isSuperGuide && callerRole !== 'Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
    }

    let userRecord = await Users.findOne({ id: input.userId, fields: ['id', 'residency', 'residencyApproved', 'guide'] });
    if (!userRecord) {
      userRecord = await Users.findOne({ filters: { userId: input.userId }, fields: ['id', 'residency', 'residencyApproved', 'guide'] });
    }
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    if (input.action === 'tag') {
      const residencyId = Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency;
      const isResident = !!(userRecord.residencyApproved && residencyId);
      if (!isResident) {
        throw new ZiteError({
          code: 'BAD_REQUEST',
          message: 'Only approved residents of a FOLK residency can be assigned the FOLK Lead role.'
        });
      }
    }

    if (!isSuperGuide) {
      const scope = await getGuideScope(context.user.email);
      if (!scope) throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide record not found' });
      if (!isUserInGuideScope(scope, userRecord)) {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only tag users in your center' });
      }
    }

    await Users.update({ id: userRecord.id, record: { isFolkLead: input.action === 'tag' } as any });
    serverCacheInvalidate('user_profile:' + userRecord.id);
    return { success: true };
  },
});
