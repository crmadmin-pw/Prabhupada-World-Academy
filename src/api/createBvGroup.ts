import { z } from 'zod';
import { createEndpoint, BvGroups, Users, Guides, AppError } from '@/lib/backend-sdk';
import { serverCacheInvalidate } from '../lib/serverCache';

export default createEndpoint({
  description: 'Create a new Bhakti Vriksha Reading Group',
  authenticated: true,
  inputSchema: z.object({
    groupName: z.string().min(1).max(200).transform(s => s.trim()),
    bvslId: z.string().min(1).max(100), // Facilitator (RGF) User ID or Email
    meetingTime: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    groupId: z.string(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const isAuthorized = context.user.role === 'SUPER_GUIDE' ||
      context.user.role === 'GUIDE' ||
      context.user.isBvAdmin ||
      context.user.isBvSuperAdmin;

    if (!isAuthorized) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Admin access required to create Reading Groups' });
    }

    // The UI supplies the app's custom userId, while Firestore relations use
    // the Users document ID. Resolve both forms before creating the group.
    // Falling back to PW here was what made newly-created FOLK groups vanish
    // from FOLK group management and from the member-assignment dropdown.
    let facilitatorUser =
      await Users.findOne({ id: input.bvslId, fields: ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'guide', 'bvReportingAdminId', 'bvReportingSupervisorId'] }).catch(() => undefined) ||
      await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'guide', 'bvReportingAdminId', 'bvReportingSupervisorId'] }).catch(() => undefined) ||
      await Users.findOne({ filters: { email: input.bvslId.toLowerCase() }, fields: ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'guide', 'bvReportingAdminId', 'bvReportingSupervisorId'] }).catch(() => undefined);

    // getGuides() can supply a Guides-table ID. Resolve it through its email
    // to the corresponding Users record when available.
    let facilitatorGuide: any = undefined;
    if (!facilitatorUser) {
      facilitatorGuide =
        await Guides.findOne({ id: input.bvslId, fields: ['id', 'guideId', 'fullName', 'email', 'segment'] }).catch(() => undefined) ||
        await Guides.findOne({ filters: { guideId: input.bvslId }, fields: ['id', 'guideId', 'fullName', 'email', 'segment'] }).catch(() => undefined);
      if (facilitatorGuide?.email) {
        facilitatorUser = await Users.findOne({
          filters: { email: facilitatorGuide.email },
          fields: ['id', 'userId', 'fullName', 'email', 'segment', 'isPrabhupadaWorldUser', 'guide', 'bvReportingAdminId', 'bvReportingSupervisorId'],
        }).catch(() => undefined);
      }
    }

    if (!facilitatorUser && !facilitatorGuide) {
      throw new AppError({ code: 'NOT_FOUND', message: 'Selected RGF was not found' });
    }

    const bvslName = facilitatorUser?.fullName || facilitatorGuide?.fullName || facilitatorUser?.email || facilitatorGuide?.email || input.bvslId;
    const segment = facilitatorUser?.segment || facilitatorGuide?.segment ||
      (facilitatorUser?.isPrabhupadaWorldUser ? 'PW' : (context.user.segment || 'PW'));
    const guideOwnerId = facilitatorUser?.bvReportingSupervisorId ||
      facilitatorUser?.bvReportingAdminId ||
      facilitatorUser?.guide ||
      context.user.userId ||
      context.user.id;

    const groupId = `BV-GROUP-${Date.now()}`;
    const newGroup = {
      id: groupId,
      groupId,
      groupName: input.groupName,
      bvslLeader: facilitatorUser?.id || undefined,
      bvslId: facilitatorUser?.userId || facilitatorUser?.id || facilitatorGuide?.guideId || facilitatorGuide?.id,
      bvslName,
      guide: guideOwnerId || undefined,
      meetingTime: input.meetingTime || '',
      description: input.description || '',
      isActive: true,
      segment,
      createdAt: new Date().toISOString(),
    };

    await BvGroups.create({ record: newGroup });
    // Invalidate the admin group-list cache so the new group appears immediately.
    serverCacheInvalidate('allBvGroupsAdmin:');

    return {
      success: true,
      groupId,
    };
  },
});
