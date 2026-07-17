import { z } from 'zod';
import { createEndpoint, UserSkills, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Remove a skill from a user',
  authenticated: true,
  inputSchema: z.object({
    userSkillId: z.string().optional(),
    rowId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const id = input.userSkillId || input.rowId;
    if (!id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'userSkillId is required' });

    const record = await UserSkills.findOne({ id });
    if (!record) throw new ZiteError({ code: 'NOT_FOUND', message: 'User skill record not found' });

    await UserSkills.delete({ id });

    return { success: true };
  },
});
