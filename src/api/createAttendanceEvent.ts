import { z } from 'zod';
import { createEndpoint, AppError, AttendanceEvents } from '@/lib/backend-sdk';

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
    const userRole = (context.user?.role || '').toUpperCase();
    const user = context.user as any;
    const isAuthorized = [
      'GUIDE', 'SUPER_GUIDE', 'SUPER GUIDE', 'ADMIN', 'SUPER_ADMIN', 'BVSL', 'PW_ADMIN',
    ].includes(userRole) || !!user?.isBvsl || !!user?.isBvAdmin || !!user?.isBvSuperAdmin || !!user?.isPwAdmin;
    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Not authorized' });
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
