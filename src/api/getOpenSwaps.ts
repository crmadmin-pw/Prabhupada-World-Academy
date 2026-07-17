import { z } from 'zod';
import { createEndpoint, ServiceSwaps, ServiceAllocations, Services, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get open swap requests that the current user can accept',
  authenticated: true,
  inputSchema: z.object({ residencyId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const uid = context.user!.id;
    // Get open swaps not from this user
    const swapRes = await ServiceSwaps.findAll({
      filters: { status: 'Open' },
      limit: 50,
      fields: ['id', 'swapId', 'allocation', 'fromUser', 'reason', 'createdAt'],
    });

    const swaps = swapRes.records.filter(s => {
      const fromUser = Array.isArray(s.fromUser) ? s.fromUser[0] : s.fromUser;
      return fromUser !== uid;
    });

    if (swaps.length === 0) return { swaps: [] };

    // Get allocation details
    const allocIds = swaps.map(s => Array.isArray(s.allocation) ? s.allocation[0] : s.allocation).filter(Boolean) as string[];
    const fromUserIds = swaps.map(s => Array.isArray(s.fromUser) ? s.fromUser[0] : s.fromUser).filter(Boolean) as string[];

    const [allocRes, usersRes] = await Promise.all([
      ServiceAllocations.findAll({ filters: { id: { in: allocIds } }, fields: ['id', 'service', 'dayOfWeek', 'weekDate', 'status'] }),
      Users.findAll({ filters: { id: { in: fromUserIds } }, fields: ['id', 'fullName'] }),
    ]);

    const svcIds = [...new Set(allocRes.records.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean))] as string[];
    const svcRes = svcIds.length > 0 ? await Services.findAll({ filters: { id: { in: svcIds } }, fields: ['id', 'serviceName', 'timeSlot'] }) : { records: [] };

    const allocMap = new Map(allocRes.records.map(a => [a.id, a]));
    const userMap = new Map(usersRes.records.map(u => [u.id, u.fullName || '']));
    const svcMap = new Map<string, any>(svcRes.records.map(s => [s.id, s] as [string, any]));

    return {
      swaps: swaps.map(s => {
        const allocId = Array.isArray(s.allocation) ? s.allocation[0] : s.allocation;
        const fromUserId = Array.isArray(s.fromUser) ? s.fromUser[0] : s.fromUser;
        const alloc = allocMap.get(allocId || '');
        const svcId = alloc ? (Array.isArray(alloc.service) ? alloc.service[0] : alloc.service) : null;
        const svc = svcMap.get(svcId || '');
        return {
          swapId: s.swapId || s.id,
          requestId: s.swapId || s.id,
          allocationId: allocId || '',
          requesterId: fromUserId || '',
          fromUserName: userMap.get(fromUserId || '') || '',
          requesterName: userMap.get(fromUserId || '') || '',
          serviceName: (svc as any)?.serviceName || '',
          timeSlot: (svc as any)?.timeSlot || '',
          dayOfWeek: alloc?.dayOfWeek || '',
          weekDate: alloc?.weekDate || '',
          reason: s.reason || '',
          createdAt: s.createdAt || '',
        };
      }),
    };
  },
});
