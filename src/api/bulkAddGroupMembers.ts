import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, AppError } from '@/lib/backend-sdk';

export default createEndpoint({
  description: 'Bulk add multiple users to a BV group (guide-driven, by DB record IDs)',
  authenticated: true,
  inputSchema: z.object({
    groupDbId: z.string(),
    userIds: z.array(z.string()),
  }),
  outputSchema: z.object({ added: z.number(), alreadyMembers: z.number() }),
  execute: async ({ input, context }: any) => {
    const callerRole = context.user!.role || '';
    const isBvMentor = !!(context.user as any).isBvMentor;
    const isBvAdmin = !!(context.user as any).isBvAdmin;
    const isBvSuperAdmin = !!(context.user as any).isBvSuperAdmin;
    const allowedRoles = ['Guide', 'Super Guide', 'Admin', 'Super Admin', 'SUPER_ADMIN', 'SUPER_GUIDE', 'BVSL'];
    if (!allowedRoles.includes(callerRole) && !isBvMentor && !isBvAdmin && !isBvSuperAdmin) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only guides, admins, or BV Mentors can bulk add members' });
    }

    // Try by DB UUID first, then by custom groupId field
    let group = await BvGroups.findOne({ id: input.groupDbId, fields: ['id', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'guide'] });
    if (!group) group = await BvGroups.findOne({ filters: { groupId: input.groupDbId }, fields: ['id', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'guide'] });
    if (!group) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });
    const resolvedGroupId = group.id;

    // Resolve Reading Group Facilitator (RGF) for default parent link
    const rawRgfId = Array.isArray(group.bvslLeader) ? group.bvslLeader[0] : (group.bvslLeader || group.bvslId || group.guide);
    let rgfUser: any = null;
    const Users = (await import('@/lib/backend-sdk')).Users;
    if (rawRgfId) {
      rgfUser = await Users.findOne({ id: rawRgfId })
             || await Users.findOne({ filters: { userId: rawRgfId } });
    }

    const formatEmailToName = (nameStr: string, fallback: string) => {
      const val = nameStr || fallback || '';
      if (val.includes('@')) {
        const parts = val.split('@')[0].split(/[._-]/);
        return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') + ' Prabhu';
      }
      return val;
    };

    const rgfUserId = rgfUser ? (rgfUser.userId || rgfUser.id) : String(rawRgfId || '');
    const rgfName = formatEmailToName(rgfUser ? (rgfUser.fullName || rgfUser.name || '') : '', String(group.bvslName || ''));
    const rgfSupId = rgfUser ? String(rgfUser.bvReportingSupervisorId || '') : '';
    const rgfSupName = formatEmailToName(rgfUser ? String(rgfUser.bvReportingSupervisorName || '') : '', '');
    const rgfAdminId = rgfUser ? String(rgfUser.bvReportingAdminId || '') : '';
    const rgfAdminName = formatEmailToName(rgfUser ? String(rgfUser.bvReportingAdminName || '') : '', '');

    // Standardize all input userIds to standard Users table database UUIDs
    const resolvedUserIds: string[] = [];
    for (const uId of input.userIds) {
      const user = await Users.findOne({ id: uId })
                || await Users.findOne({ filters: { userId: uId } });
      if (user) {
        resolvedUserIds.push(user.id);
      }
    }

    const { records: existing } = await BvGroupMembers.findAll({
      filters: { group: resolvedGroupId },
      fields: ['user'],
      limit: 2000,
    });
    const existingSet = new Set(
      existing.map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string).filter(Boolean)
    );

    const toAdd = resolvedUserIds.filter(id => !existingSet.has(id));

    // Update Users records in parallel/sequence to set BV Group and reporting parents
    for (const userId of toAdd) {
      await Users.update({
        id: userId,
        record: {
          bvGroupId: resolvedGroupId,
          bvGroupName: group.groupName || '',
          bvReportingFacilitatorId: rgfUserId,
          bvReportingFacilitatorName: rgfName,
          bvReportingSupervisorId: rgfSupId,
          bvReportingSupervisorName: rgfSupName,
          bvReportingAdminId: rgfAdminId,
          bvReportingAdminName: rgfAdminName,
          supervisorName: rgfName,
          isBvMember: true,
          sadhanaMentor: null,
          ...(rgfAdminId ? { guide: rgfAdminId } : {}),
        },
      }).catch(() => {});
    }

    for (let i = 0; i < toAdd.length; i += 100) {
      const batch = toAdd.slice(i, i + 100);
      await BvGroupMembers.bulkCreate({
        records: batch.map(userId => ({
          user: userId,
          group: resolvedGroupId,
          role: 'Member',
          joinedAt: new Date().toISOString(),
        })),
      });
    }

    return { added: toAdd.length, alreadyMembers: input.userIds.length - toAdd.length };
  },
});
