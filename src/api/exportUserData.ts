import { z } from 'zod';
import { createEndpoint, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Export user data as structured records',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    status: z.string().optional(),
    email: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const filter: any = {};
    if (input.status) filter.status = input.status;

    const { records } = await Users.findAll({
      filters: filter,
      fields: ['id', 'userId', 'fullName', 'phone', 'email', 'ashrayLevel', 'status', 'createdAt', 'lastLoginAt'],
      limit: 2000,
    });

    return {
      users: records.map((u: any) => ({
        userId: (u.userId as string) || u.id,
        fullName: (u.fullName as string) || '',
        phone: u.phone || '',
        email: (u.email as string) || '',
        ashrayLevel: (u.ashrayLevel as string) || '',
        status: (u.status as string) || '',
        createdAt: (u.createdAt as string) || '',
        lastLoginAt: (u.lastLoginAt as string) || '',
      })),
    };
  },
});
