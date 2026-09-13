import { z } from 'zod';
import { createEndpoint, AppError, AttendanceEvents } from '@/lib/backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Create a new attendance event',
  inputSchema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    location: z.string().optional(),
    customFields: z.string().optional(),
  }),
  outputSchema: z.object({
    event: z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
    }),
  }),
  execute: async ({ input, context }) => {
    const role = (context.user?.role || '').toUpperCase();
    const isAuthorized = ['SUPER_ADMIN', 'SUPER_GUIDE', 'ADMIN', 'GUIDE', 'BVSL', 'PW_ADMIN'].includes(role);
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Not authorized to create events' });
    }
    const now = new Date().toISOString();
    const event = await AttendanceEvents.create({
      title: input.title,
      description: input.description ?? '',
      startDate: input.startDate ?? now,
      endDate: input.endDate ?? now,
      location: input.location ?? '',
      customFields: input.customFields ?? '[]',
      createdAt: now,
    });
    return { event };
  },
});
