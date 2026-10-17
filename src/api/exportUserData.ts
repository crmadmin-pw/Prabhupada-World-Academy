import { z } from 'zod';
import { createEndpoint, Users } from '@/lib/backend-sdk';
import { getScopedHierarchyUserIds, HIERARCHY_IDENTITY_FIELDS, isUserInHierarchy } from '@/lib/hierarchyUtils';

export default createEndpoint({
  description: 'Export user data as structured records',
  authenticated: true,
  // Contact details for members: the same audience and hierarchy rule as the
  // member profile and CRM endpoints. Super admins receive every member.
  requiredCapabilities: 'users.assigned.read',
  inputSchema: z.object({
    guideId: z.string().optional(),
    status: z.string().optional(),
    email: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const filter: any = {};
    if (input.status) filter.status = input.status;

    const scope = await getScopedHierarchyUserIds(context.user);
    const { records } = await Users.findAll({
      filters: filter,
      fields: [...HIERARCHY_IDENTITY_FIELDS, 'fullName', 'phone', 'ashrayLevel', 'status', 'createdAt', 'lastLoginAt'],
      limit: 2000,
    });

    return {
      users: records
        .filter((u: any) => isUserInHierarchy(u, scope))
        .map((u: any) => ({
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
