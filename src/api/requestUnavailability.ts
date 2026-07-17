import { z } from 'zod';
import { createEndpoint, UnavailabilityRequests } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Request unavailability for a specific date (resident submits a leave request)',
  authenticated: true,
  inputSchema: z.object({
    date: z.string(), // YYYY-MM-DD
    reason: z.string().optional(),
    allocationId: z.string().optional(), // Optional: link to a specific allocation
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const record = await UnavailabilityRequests.create({
      record: {
        user: context.user!.id,
        date: input.date,
        reason: input.reason || '',
        status: 'Pending',
        serviceAllocation: input.allocationId || undefined,
        createdAt: new Date().toISOString(),
      },
    });
    return { success: true, requestId: record.requestId };
  },
});
