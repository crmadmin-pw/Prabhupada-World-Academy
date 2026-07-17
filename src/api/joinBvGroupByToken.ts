import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Join a BV group using a join token (from WhatsApp invite link)',
  authenticated: true,
  inputSchema: z.object({
    token: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    alreadyMember: z.boolean(),
    groupName: z.string().nullable(),
    error: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!input.token) {
      return { success: false, alreadyMember: false, groupName: null, error: 'Missing invite token' };
    }

    // Find the group by join token
    const { records: groupRecords } = await BvGroups.findAll({
      filters: { joinToken: input.token, isActive: true },
      limit: 1,
    });

    const group = groupRecords[0];
    if (!group) {
      return { success: false, alreadyMember: false, groupName: null, error: 'Invalid or expired invite link' };
    }

    // Get the user's DB record ID
    const userRecord = await Users.findOne({ id: context.user.id, fields: ['id', 'guide', 'fullName'] });
    if (!userRecord) {
      return { success: false, alreadyMember: false, groupName: null, error: 'User not found' };
    }

    // BUG-7 FIX: Validate user is under same guide as the group
    const userGuideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
    const groupGuideId = Array.isArray(group.guide) ? group.guide[0] : group.guide;

    if (groupGuideId && userGuideId && groupGuideId !== userGuideId) {
      return {
        success: false, alreadyMember: false, groupName: group.groupName || null,
        error: 'You are not under this guide — cannot join this group',
      };
    }

    // Check if already a member of THIS specific group
    const existing = await BvGroupMembers.findOne({
      filters: { group: group.id, user: context.user.id },
    });

    if (existing) {
      return { success: true, alreadyMember: true, groupName: group.groupName || null, error: null };
    }

    // Check if already a member of ANY BV group — users can only be in one group
    const { records: anyMembership } = await BvGroupMembers.findAll({
      filters: { user: context.user.id },
      limit: 1,
      fields: ['id', 'group'],
    });

    if (anyMembership.length > 0) {
      const existingGroupId = Array.isArray(anyMembership[0].group)
        ? anyMembership[0].group[0]
        : anyMembership[0].group as string;
      const existingGroup = existingGroupId
        ? await BvGroups.findOne({ id: existingGroupId, fields: ['id', 'groupName'] })
        : null;
      const existingGroupName = (existingGroup as any)?.groupName || 'another group';
      return {
        success: false,
        alreadyMember: false,
        groupName: group.groupName || null,
        error: `You are already a member of "${existingGroupName}". You can only be in one BV group at a time.`,
      };
    }

    // Add as member
    await BvGroupMembers.create({
      record: {
        group: group.id,
        user: context.user.id,
        role: 'Member',
        joinedAt: new Date().toISOString(),
      },
    });

    return { success: true, alreadyMember: false, groupName: group.groupName || null, error: null };
  },
});
