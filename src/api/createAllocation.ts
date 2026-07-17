import { z } from 'zod';
import { createEndpoint, ServiceAllocations, ZiteError } from 'zite-integrations-backend-sdk';

const DOW_MAP: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

// Service week: Sunday → Saturday
const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default createEndpoint({
  description: 'Create a service allocation for a user. Pass all 7 days to assign for the whole week (default behaviour).',
  authenticated: true,
  inputSchema: z.object({
    serviceId: z.string(),
    userId: z.string(),
    weekStartDate: z.string(),
    // When omitted or empty, defaults to the full week (all 7 days)
    days: z.array(z.string()).optional(),
    notes: z.string().optional(),
    backupUserId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    if (!input.serviceId || !input.userId || !input.weekStartDate) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'serviceId, userId, and weekStartDate are required' });
    }

    // Default to whole week if no days specified
    const days = (input.days && input.days.length > 0) ? input.days : ALL_DAYS;

    const records = days.map(day => ({
      service: input.serviceId,
      user: input.userId,
      weekDate: input.weekStartDate,
      dayOfWeek: DOW_MAP[day] || day, // accept both 'mon' and 'Monday'
      notes: input.notes || '',
      status: 'Scheduled' as const,
      backupUser: input.backupUserId || undefined,
      isBackup: false,
    }));

    await ServiceAllocations.bulkCreate({ records });

    return { success: true, created: records.length };
  },
});
