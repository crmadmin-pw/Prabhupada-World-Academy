import { z } from 'zod';
import { createEndpoint, SkillCatalog, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Create, update, or deactivate a skill in the catalog',
  authenticated: true,
  inputSchema: z.object({
    action: z.enum(['create', 'update', 'deactivate', 'add', 'remove']),
    skillId: z.string().optional(),
    skillName: z.string().optional(),
    description: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Map legacy action names
    const action = input.action === 'add' ? 'create' : input.action === 'remove' ? 'deactivate' : input.action;

    if (action === 'create') {
      if (!input.skillName) throw new ZiteError({ code: 'BAD_REQUEST', message: 'skillName is required for create' });
      const record = await SkillCatalog.create({
        record: {
          skillName: input.skillName,
          description: input.description || '',
          isActive: true,
        },
      });
      return { success: true, skillId: record.id };
    }

    // Find by skillName if skillId not provided
    let resolvedId = input.skillId;
    if (!resolvedId && input.skillName) {
      const existing = await SkillCatalog.findOne({ filters: { skillName: input.skillName } });
      if (existing) resolvedId = existing.id;
    }

    if (!resolvedId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'skillId or skillName is required' });

    if (action === 'deactivate') {
      await SkillCatalog.update({ id: resolvedId, record: { isActive: false } });
      return { success: true };
    }

    const updates: any = {};
    if (input.skillName !== undefined) updates.skillName = input.skillName;
    if (input.description !== undefined) updates.description = input.description;
    await SkillCatalog.update({ id: resolvedId, record: updates });

    return { success: true };
  },
});
