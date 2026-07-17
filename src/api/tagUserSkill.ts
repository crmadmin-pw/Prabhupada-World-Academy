import { z } from 'zod';
import { createEndpoint, UserSkills, Users, SkillCatalog, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Tag a skill to a user',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    skillId: z.string().optional(),
    skillName: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    if (!input.skillId && !input.skillName) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'skillId or skillName is required' });
    }

    const user = await Users.findOne({ filters: { userId: input.userId }, fields: ['id'] });
    if (!user) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    let skillDbId = input.skillId;

    if (!skillDbId && input.skillName) {
      // Find or get the skill catalog entry
      const existing = await SkillCatalog.findOne({ filters: { skillName: input.skillName } });
      skillDbId = existing?.id;
    }

    if (!skillDbId) {
      // Create the skill if it doesn't exist
      if (input.skillName) {
        const newSkill = await SkillCatalog.create({
          record: { skillName: input.skillName, isActive: true },
        });
        skillDbId = newSkill.id;
      } else {
        throw new ZiteError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }
    }

    const existingSkill = await UserSkills.findOne({ filters: { user: user.id, skill: skillDbId } });
    if (existingSkill) return { success: true };

    await UserSkills.create({
      record: {
        user: user.id,
        skill: skillDbId,
      },
    });

    return { success: true };
  },
});
