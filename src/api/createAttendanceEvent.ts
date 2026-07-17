import { z } from 'zod';
import { createEndpoint, ZiteError, AttendanceEvents } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create an attendance event',
  inputSchema: z.object({
    title: z.string(),
    description: z.string().optional(),
    startDate: z.string(),
    endDate: z.string(),
    customFields: z.string().optional(),
  }),
  outputSchema: z.object({ id: z.string() }),
  execute: async ({ input, context }) => {
    const role = context.user.role || '';
    if (!['Guide', 'Super Guide', 'BVSL'].includes(role) && !context.user.isBvsl) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Not authorized' });
    }
    const event = await AttendanceEvents.create({
      record: {
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        customFields: input.customFields || '[]',
        createdBy: context.user.id,
      },
    });
    return { id: event.id };
  },
});
