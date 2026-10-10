import { z } from 'zod';
import { createEndpoint, BvGroups, AppError } from '@/lib/backend-sdk';
import { normalizeBvDepartment, runningTimeSlotsFromGroups } from '@/lib/bvRunningTimeSlots';

export default createEndpoint({
  description: 'Meeting times of active Bhakti Vriksha groups for the join form',
  authenticated: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK']).optional(),
    bypassCache: z.boolean().optional(),
  }),
  outputSchema: z.object({
    timeSlots: z.array(z.string()),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const segment = input.segment || normalizeBvDepartment(context.user.segment) || 'PW';
    const { records } = await BvGroups.findAll({
      limit: 1000,
      fields: ['meetingTime', 'preferredTimeSlot', 'segment', 'isActive'],
    });
    return { timeSlots: runningTimeSlotsFromGroups(records, segment) };
  },
});
