import { z } from 'zod';
import { createEndpoint, UserSkills } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Remove a skill from the current user',
  authenticated: true,
  inputSchema: z.object({ rowId: z.union([z.string(), z.number()]) }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const record = await UserSkills.findOne({ id: String(input.rowId) });
    if (!record) return { success: false };
    const userId = Array.isArray(record.user) ? record.user[0] : record.user;
    if (userId !== context.user!.id) throw new Error('Not your skill');
    await UserSkills.delete({ id: record.id });
    return { success: true };
  },
});
