import { z } from 'zod';
import { createEndpoint, BvGroupMembers, BvGroupRequests, BvGroups, AppError } from '@/lib/backend-sdk';
import { publishCollectionRevision } from '../lib/publishUsersRevision';

export default createEndpoint({
  description: 'Request to join a BV group — prevents joining more than one group',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional(), groupId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;

    // Resolve custom groupId to DB UUID
    let groupRecord = await BvGroups.findOne({
      filters: { groupId: input.groupId },
      fields: ['id', 'groupName', 'isActive'],
    });
    if (!groupRecord) {
      groupRecord = await BvGroups.findOne({
        id: input.groupId,
        fields: ['id', 'groupName', 'isActive'],
      });
    }
    if (!groupRecord) throw new AppError({ code: 'NOT_FOUND', message: 'Group not found' });
    if (!groupRecord.isActive) throw new AppError({ code: 'BAD_REQUEST', message: 'Group is no longer active' });

    const groupDbId = groupRecord.id;

    // Check if already a member of THIS specific group
    const [memberRes, requestRes] = await Promise.all([
      BvGroupMembers.findAll({ filters: { user: uid, group: groupDbId }, limit: 1, fields: ['id'] }),
      BvGroupRequests.findAll({ filters: { user: uid, group: groupDbId, status: 'Pending' }, limit: 1, fields: ['id'] }),
    ]);

    if (memberRes.records.length > 0) return { success: false, alreadyMember: true, alreadyRequested: false, groupName: groupRecord.groupName };
    if (requestRes.records.length > 0) return { success: false, alreadyMember: false, alreadyRequested: true, groupName: groupRecord.groupName };

    // FIX: Check if already a member of ANY BV group — users can only join one group
    const anyMembership = await BvGroupMembers.findAll({
      filters: { user: uid },
      limit: 1,
      fields: ['id', 'group'],
    });

    if (anyMembership.records.length > 0) {
      // Find the group name they're already in
      const existingGroupId = Array.isArray(anyMembership.records[0].group)
        ? anyMembership.records[0].group[0]
        : anyMembership.records[0].group as string;
      const existingGroup = existingGroupId
        ? await BvGroups.findOne({ id: existingGroupId, fields: ['id', 'groupName'] })
        : null;
      const existingGroupName = (existingGroup as any)?.groupName || 'another group';
      throw new AppError({
        code: 'CONFLICT',
        message: `You are already a member of "${existingGroupName}". You cannot join more than one BV group.`,
      });
    }

    const created = await BvGroupRequests.create({
      record: {
        group: groupDbId,
        user: uid,
        status: 'Pending',
        requestedAt: new Date().toISOString(),
      },
    });
    await publishCollectionRevision('BvGroupRequests', created?.id);
    return { success: true, alreadyMember: false, alreadyRequested: false, groupName: groupRecord.groupName };
  },
});
