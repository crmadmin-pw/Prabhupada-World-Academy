import { createEndpoint, BvGroups, BvGroupMembers, AppError } from '@/lib/backend-sdk';
import { uncountedAssignedStaff } from '@/lib/bvGroupFacilitators';
import { z } from 'zod';

export default createEndpoint({
  description: 'Get all BV groups in the system for system administration (Super Admin only)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    groups: z.array(z.object({
      id: z.string(),
      groupName: z.string(),
      bvslName: z.string().nullable(),
      isActive: z.boolean(),
      memberCount: z.number(),
      segment: z.string().nullable(),
    })),
  }),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperAdmin = !!(
      context.user.isBvSuperAdmin ||
      (context.user.role || '').toLowerCase().includes('super')
    );
    if (!isSuperAdmin) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Super Admin access required' });
    }

    const { records: groups } = await BvGroups.findAll({ limit: 1000 });

    const enrichedGroups = await Promise.all(groups.map(async (g) => {
      const membersRes = await BvGroupMembers.findAll({ filters: { group: g.id }, limit: 1000, fields: ['id', 'user', 'userId', 'memberId'] });
      const counted = new Set(membersRes.records.flatMap((member: any) =>
        [member.user, member.userId, member.memberId].map((value: unknown) => String(value || '').trim().toLowerCase()).filter(Boolean),
      ));
      return {
        id: g.id,
        groupName: g.groupName || '',
        bvslName: g.bvslName || null,
        isActive: g.isActive ?? true,
        memberCount: membersRes.records.length + uncountedAssignedStaff(g, counted),
        segment: g.segment || null,
      };
    }));

    return { groups: enrichedGroups };
  },
});
