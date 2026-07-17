import { z } from 'zod';
import { createEndpoint, BvGroups, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Update a BV group name, description, or WhatsApp link',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string(),
    groupName: z.string().optional(),
    description: z.string().optional(),
    whatsAppLink: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const group = await BvGroups.findOne({ filters: { groupId: input.groupId }, fields: ['id'] })
      ?? await BvGroups.findOne({ id: input.groupId, fields: ['id'] });
    if (!group) throw new ZiteError({ code: 'NOT_FOUND', message: 'Group not found' });

    const updates: any = {};
    if (input.groupName !== undefined) updates.groupName = input.groupName;
    if (input.description !== undefined) updates.description = input.description;
    if (input.whatsAppLink !== undefined) updates.whatsAppLink = input.whatsAppLink;

    await BvGroups.update({ id: group.id, record: updates });

    return { success: true };
  },
});
