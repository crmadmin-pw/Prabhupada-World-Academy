import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, AppError } from '@/lib/backend-sdk';

function firstValue(value: unknown): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export default createEndpoint({
  description: 'Join a BV group using an invite token',
  authenticated: true,
  inputSchema: z.object({
    token: z.string(),
    userId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const token = String(input.token || '').trim();
    if (!token) throw new AppError({ code: 'BAD_REQUEST', message: 'Missing invite token' });

    const group = await BvGroups.findOne({ filters: { joinToken: token } });
    if (!group || group.isActive === false) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Invalid or expired invite link' });
    }

    const userFields = ['id', 'userId', 'fullName', 'email', 'bvGroupId', 'status'];
    const userRecord = await Users.findOne({ id: context.user.id, fields: userFields })
      || (context.user.userId ? await Users.findOne({ filters: { userId: context.user.userId }, fields: userFields }) : null)
      || (context.user.email ? await Users.findOne({ filters: { email: context.user.email }, fields: userFields }) : null);
    if (!userRecord) {
      return {
        success: false,
        needsRegistration: true,
        groupName: group.groupName || null,
        message: 'Create your account to join this group',
      };
    }

    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { user: userRecord.id },
      limit: 20,
      fields: ['id', 'group', 'groupId', 'user'],
    });
    const groupKeys = new Set([group.id, group.groupId].filter(Boolean).map(value => String(value)));
    const alreadyHere = memberships.some(membership =>
      groupKeys.has(firstValue(membership.group)) || groupKeys.has(firstValue(membership.groupId)),
    );
    if (alreadyHere) {
      return { success: true, needsRegistration: false, groupName: group.groupName, message: 'You are already a member of this group' };
    }
    if (memberships.length > 0) {
      throw new AppError({
        code: 'CONFLICT',
        message: 'You are already a member of another Bhakti Vriksha group. You can only be in one group at a time.',
      });
    }

    await BvGroupMembers.create({
      record: {
        user: userRecord.id,
        userId: userRecord.userId || userRecord.id,
        group: group.id,
        groupId: group.groupId || group.id,
        role: 'Member',
        joinedAt: new Date().toISOString(),
      },
    });

    const rawRgfId = firstValue(group.bvslLeader) || firstValue(group.bvslId);
    const rgfFields = ['id', 'userId', 'fullName', 'bvReportingSupervisorId', 'bvReportingSupervisorName', 'bvReportingAdminId', 'bvReportingAdminName'];
    const rgfUser = rawRgfId
      ? await Users.findOne({ id: rawRgfId, fields: rgfFields })
        || await Users.findOne({ filters: { userId: rawRgfId }, fields: rgfFields })
      : null;
    const rgfUserId = rgfUser ? String(rgfUser.userId || rgfUser.id || '') : rawRgfId;

    await Users.update({
      id: userRecord.id,
      record: {
        bvGroupId: group.id,
        bvGroupName: group.groupName || '',
        bvRegistrationStatus: 'Approved',
        isBvMember: true,
        sadhanaMentor: null,
        ...(rgfUserId ? {
          bvReportingFacilitatorId: rgfUserId,
          bvReportingFacilitatorName: String(rgfUser?.fullName || group.bvslName || ''),
          bvReportingSupervisorId: String(rgfUser?.bvReportingSupervisorId || ''),
          bvReportingSupervisorName: String(rgfUser?.bvReportingSupervisorName || ''),
          bvReportingAdminId: String(rgfUser?.bvReportingAdminId || ''),
          bvReportingAdminName: String(rgfUser?.bvReportingAdminName || ''),
        } : {}),
      },
    });

    return {
      success: true,
      needsRegistration: false,
      groupName: group.groupName,
      message: `Successfully joined ${group.groupName}!`,
    };
  },
});
