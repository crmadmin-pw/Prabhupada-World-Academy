import { z } from 'zod';
import { createEndpoint, ServiceAvailability } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get the availability for the current user for a given week',
  authenticated: true,
  inputSchema: z.object({ weekStartDate: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const record = await ServiceAvailability.findOne({
      filters: { user: context.user!.id, weekDate: input.weekStartDate },
    });
    if (!record) return { availability: null };
    return {
      availability: {
        availableDaysJson: record.availableDaysJson || '[]',
        submittedAt: null,
        updatedAt: null,
      },
    };
  },
});
