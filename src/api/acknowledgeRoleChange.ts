import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Acknowledge assignment or removal of devotee roles',
  authenticated: true,
  inputSchema: z.object({
    roleType: z.enum(['folk_lead', 'trip_coordinator', 'sadhana_mentor']),
    acknowledged: z.boolean(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');

    const updateData: any = {};
    if (input.roleType === 'folk_lead') {
      updateData.acknowledgedFolkLead = input.acknowledged;
    } else if (input.roleType === 'trip_coordinator') {
      updateData.acknowledgedTripCoordinator = input.acknowledged;
    } else if (input.roleType === 'sadhana_mentor') {
      updateData.acknowledgedSadhanaMentor = input.acknowledged;
    }

    await Users.update({ id: context.user.id, record: updateData });
    serverCacheInvalidate('user_profile:' + context.user.id);
    return { success: true };
  },
});
