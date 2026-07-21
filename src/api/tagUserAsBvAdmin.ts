import { z } from 'zod';
import { createEndpoint, Users, ZiteError } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';
import { profileCacheKey } from './getUserProfile';

export default createEndpoint({
  description: 'Tag or untag a user as BV Admin — Super Admin or Super Guide only',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    action: z.enum(['tag', 'untag']),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    const isSuperAdmin = role === 'SUPER_GUIDE' || context.user.isBvSuperAdmin || (context.user.email || '').toLowerCase().includes('superadmin');
    if (!isSuperAdmin) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Super Admin access required to assign Admins' });
    }

    const userRecord = await Users.findOne({ id: input.userId, fields: ['id'] });
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const shouldTag = input.action === 'tag';
    await Users.update({ id: userRecord.id, record: { isBvAdmin: shouldTag } });
    serverCacheInvalidate(profileCacheKey(input.userId));

    return { success: true };
  },
});
