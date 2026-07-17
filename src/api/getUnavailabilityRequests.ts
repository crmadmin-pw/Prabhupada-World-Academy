import { z } from 'zod';
import { createEndpoint, UnavailabilityRequests, Users, ServiceAllocations, Services } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get unavailability requests — guides see all pending/recent, residents see their own',
  authenticated: true,
  inputSchema: z.object({
    status: z.string().optional(), // 'Pending' | 'Approved' | 'Rejected' | 'all'
    limit: z.number().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = context.user.role || '';
    const isGuide = role === 'Guide' || role === 'Super Guide' || context.user.isServiceAllocator === true;

    const filters: any = {};
    if (!isGuide) {
      filters.user = context.user.id;
    }
    if (input.status && input.status !== 'all') {
      filters.status = input.status;
    }

    const { records } = await UnavailabilityRequests.findAll({
      filters,
      limit: input.limit || 100,
    });

    if (records.length === 0) return { requests: [] };

    // Collect user ids
    const userIds = [...new Set(records.map(r => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const usersRes = await Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'fullName'], limit: 200 });
      usersRes.records.forEach(u => { userMap[u.id] = u.fullName || ''; });
    }

    // Collect allocation/service info
    const allocIds = [...new Set(records.map(r => Array.isArray(r.serviceAllocation) ? r.serviceAllocation[0] : r.serviceAllocation).filter(Boolean))] as string[];
    const allocMap: Record<string, { serviceName: string }> = {};
    if (allocIds.length > 0) {
      const allocRes = await ServiceAllocations.findAll({ filters: { id: { in: allocIds } }, fields: ['id', 'service'], limit: 200 });
      const svcIds = [...new Set(allocRes.records.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean))] as string[];
      const svcMap: Record<string, string> = {};
      if (svcIds.length > 0) {
        const svcRes = await Services.findAll({ filters: { id: { in: svcIds } }, fields: ['id', 'serviceName'], limit: 200 });
        svcRes.records.forEach(s => { svcMap[s.id] = s.serviceName || ''; });
      }
      allocRes.records.forEach(a => {
        const svcId = Array.isArray(a.service) ? a.service[0] : a.service;
        allocMap[a.id] = { serviceName: svcId ? svcMap[svcId] || '' : '' };
      });
    }

    return {
      requests: records.map(r => {
        const uid = Array.isArray(r.user) ? r.user[0] : r.user;
        const allocId = Array.isArray(r.serviceAllocation) ? r.serviceAllocation[0] : r.serviceAllocation;
        return {
          id: r.id,
          requestId: r.requestId,
          userId: uid || '',
          userName: userMap[uid || ''] || '',
          date: r.date || '',
          reason: r.reason || '',
          status: r.status || 'Pending',
          serviceName: allocId ? allocMap[allocId]?.serviceName || '' : '',
          allocationId: allocId || null,
          createdAt: r.createdAt || '',
        };
      }),
    };
  },
});
