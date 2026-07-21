import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvMemberRegistrations, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get overview stats and group list for BV Supervisor dashboard',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    rgfCount: z.number(),
    groupCount: z.number(),
    totalMembers: z.number(),
    pendingRegistrations: z.number(),
    groups: z.array(z.object({
      id: z.string(),
      groupName: z.string(),
      bvslId: z.string(),
      bvslName: z.string(),
      meetingTime: z.string().optional(),
      memberCount: z.number(),
    })),
  }),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const userEmail = (context.user.email || '').toLowerCase();
    const isAuthorized = context.user.role === 'SUPER_GUIDE' ||
      context.user.role === 'GUIDE' ||
      userEmail === 'srilaprabhupadaworld@gmail.com' ||
      context.user.isBvAdmin ||
      context.user.isBvSuperAdmin ||
      context.user.isBvSupervisor ||
      context.user.isBvMentor;

    if (!isAuthorized) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Supervisor access required' });
    }

    // Fetch active groups
    const { records: groups } = await BvGroups.findAll({ filters: { isActive: true }, limit: 500 });
    const { records: members } = await BvGroupMembers.findAll({ limit: 2000 });
    const { records: pending } = await BvMemberRegistrations.findAll({ filters: { status: 'Pending Approval' }, limit: 500 });

    // Count unique RGFs (bvslId in active groups)
    const uniqueRgfs = new Set(groups.map((g: any) => g.bvslId).filter(Boolean));

    // Map group member counts
    const groupMemberCounts: Record<string, number> = {};
    members.forEach((m: any) => {
      if (m.groupId) {
        groupMemberCounts[m.groupId] = (groupMemberCounts[m.groupId] || 0) + 1;
      }
    });

    const mappedGroups = groups.map((g: any) => ({
      id: g.id,
      groupName: g.groupName || 'Unnamed Group',
      bvslId: g.bvslId || '',
      bvslName: g.bvslName || 'Unassigned',
      meetingTime: g.meetingTime || '',
      memberCount: groupMemberCounts[g.id] || 0,
    }));

    return {
      rgfCount: uniqueRgfs.size,
      groupCount: groups.length,
      totalMembers: members.length,
      pendingRegistrations: pending.length,
      groups: mappedGroups,
    };
  },
});
