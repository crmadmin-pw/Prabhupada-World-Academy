import { z } from 'zod';
import { createEndpoint, ServiceAvailability, ZiteError } from 'zite-integrations-backend-sdk';

const ALL_DAYS_FULL = JSON.stringify([
  { day: 'sun', time: 'full_day' },
  { day: 'mon', time: 'full_day' },
  { day: 'tue', time: 'full_day' },
  { day: 'wed', time: 'full_day' },
  { day: 'thu', time: 'full_day' },
  { day: 'fri', time: 'full_day' },
  { day: 'sat', time: 'full_day' },
]);

export default createEndpoint({
  description: 'Bulk submit Full Day availability for a list of residents for a given week',
  authenticated: true,
  inputSchema: z.object({
    weekStartDate: z.string(),
    userIds: z.array(z.string()),
  }),
  outputSchema: z.object({ submitted: z.number(), skipped: z.number() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const callerRole = context.user.role || '';
    const canBulk = callerRole === 'Guide' || callerRole === 'Super Guide' || callerRole === 'Sadhana Mentor'
      || context.user.isServiceAllocator === true;

    if (!canBulk) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only guides or service allocators can bulk submit availability' });
    }

    // Find which userIds already have a record this week (so we skip them)
    const existing = await ServiceAvailability.findAll({
      filters: { weekDate: input.weekStartDate },
      limit: 1000,
    });
    const existingUserIds = new Set(
      existing.records
        .map(a => (Array.isArray(a.user) ? a.user[0] : a.user))
        .filter(Boolean) as string[]
    );

    const toCreate = input.userIds.filter(id => !existingUserIds.has(id));
    const skipped = input.userIds.length - toCreate.length;

    if (toCreate.length > 0) {
      await ServiceAvailability.bulkCreate({
        records: toCreate.map(userId => ({
          user: userId,
          weekDate: input.weekStartDate,
          availableDaysJson: ALL_DAYS_FULL,
        })),
      });
    }

    return { submitted: toCreate.length, skipped };
  },
});
