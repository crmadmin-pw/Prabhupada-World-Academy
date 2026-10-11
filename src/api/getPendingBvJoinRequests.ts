import { z } from 'zod';
import { createEndpoint, BvGroupRequests, BvGroups, Users } from '@/lib/backend-sdk';
import { groupHasFacilitator } from '@/lib/bvGroupFacilitators';

export default createEndpoint({
  description: 'Get pending BV group join requests for a specific BVSL or group',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string().optional(),
    bvslId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }: any) => {
    const filter: any = { status: 'Pending' };

    if (input.groupId) {
      // Filter by specific group
      const group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id'] });
      if (group) filter.group = group.id;
    } else if (input.bvslId) {
      // FIX: Filter to only this BVSL's groups
      const userRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'userId', 'email', 'fullName'] })
        || await Users.findOne({ id: input.bvslId, fields: ['id', 'userId', 'email', 'fullName'] });
      if (userRecord) {
        const aliases = new Set([userRecord.id, userRecord.userId, userRecord.email, userRecord.fullName]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(Boolean));
        const { records: activeGroups } = await BvGroups.findAll({
          filters: { isActive: true },
          fields: ['id', 'bvslLeader', 'bvslId', 'bvslName'],
          limit: 1000,
        });
        const bvslGroups = activeGroups.filter(group => groupHasFacilitator(group, aliases));
        if (bvslGroups.length === 0) return { requests: [] };
        const groupDbIds = bvslGroups.map((g: any) => g.id);
        // Filter requests to only this BVSL's groups
        filter.group = { in: groupDbIds };
      } else {
        return { requests: [] }; // Unknown BVSL, return nothing
      }
    }

    const { records: requests } = await BvGroupRequests.findAll({
      filters: filter,
      fields: ['id', 'user', 'group', 'requestedAt', 'status'],
      limit: 200,
    });

    if (requests.length === 0) return { requests: [] };

    const userIds = [...new Set(requests.map((r: any) => Array.isArray(r.user) ? r.user[0] : r.user).filter(Boolean))] as string[];
    const groupIds = [...new Set(requests.map((r: any) => Array.isArray(r.group) ? r.group[0] : r.group).filter(Boolean))] as string[];

    const [usersRes, groupsRes] = await Promise.all([
      userIds.length > 0
        ? Users.findAll({ filters: { id: { in: userIds } }, fields: ['id', 'userId', 'fullName', 'phone'], limit: 200 })
        : Promise.resolve({ records: [] }),
      groupIds.length > 0
        ? BvGroups.findAll({ filters: { id: { in: groupIds } }, fields: ['id', 'groupId', 'groupName'], limit: 200 })
        : Promise.resolve({ records: [] }),
    ]);

    const userMap: Record<string, any> = {};
    usersRes.records.forEach((u: any) => { userMap[u.id] = u; });
    const groupMap: Record<string, any> = {};
    groupsRes.records.forEach((g: any) => { groupMap[g.id] = g; });

    return {
      requests: requests.map((r: any) => {
        const uid = Array.isArray(r.user) ? r.user[0] : r.user as string;
        const gid = Array.isArray(r.group) ? r.group[0] : r.group as string;
        const u = userMap[uid] as any;
        const g = groupMap[gid] as any;
        return {
          requestId: r.id,
          logId: r.id,
          userId: u?.userId || uid || '',
          userName: u?.fullName || '',
          userPhone: u?.phone || '',
          fullName: u?.fullName || '',
          phone: u?.phone || '',
          groupId: g?.groupId || gid || '',
          groupName: g?.groupName || '',
          requestedAt: (r.requestedAt as string) || '',
          status: (r.status as string) || 'Pending',
        };
      }),
    };
  },
});
