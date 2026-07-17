import { z } from 'zod';
import { createEndpoint, UserSkills, SkillCatalog } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Add a skill to the current user',
  authenticated: true,
  inputSchema: z.object({ skillName: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const uid = context.user!.id;
    // Find skill in catalog
    const cat = await SkillCatalog.findOne({ filters: { skillName: input.skillName, isActive: true }, fields: ['id', 'skillName'] });
    if (!cat) throw new Error(`Skill "${input.skillName}" not found in catalog`);

    // Check if already added
    const existing = await UserSkills.findOne({ filters: { user: uid, skill: cat.id }, fields: ['id'] });
    if (existing) return { success: true, alreadyExists: true };

    await UserSkills.create({ record: { user: uid, skill: cat.id, level: 'Beginner' } });
    return { success: true, alreadyExists: false };
  },
});
