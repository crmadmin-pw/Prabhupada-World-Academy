import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get service profile summary for the current user',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const uid = context.user!.id;
    const [userRec, allocRes] = await Promise.all([
      Users.findOne({ id: uid, fields: ['id', 'userId', 'fullName', 'bvServiceAllocated'] }),
      ServiceAllocations.findAll({ filters: { user: uid }, limit: 200, fields: ['id', 'status', 'weekDate'] }),
    ]);

    const allocs = allocRes.records;
    const total = allocs.length;
    const completed = allocs.filter(a => a.status === 'Done').length;
    const overdue = allocs.filter(a => a.status === 'Overdue').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      userId: userRec?.userId || uid,
      fullName: userRec?.fullName || '',
      isAllocated: userRec?.bvServiceAllocated || false,
      totalAllocations: total,
      completedAllocations: completed,
      overdueAllocations: overdue,
      completionRate,
    };
  },
});
