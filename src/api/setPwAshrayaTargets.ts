import { z } from 'zod';
import { createEndpoint, AppError } from '@/lib/backend-sdk';
import { isPwAdmin, parseAshrayaConfig, saveAshrayaConfig } from '@/lib/pwTargetResolver';

export default createEndpoint({
  description: 'Save Ashraya-level Prabhupada World sadhana targets',
  authenticated: true,
  inputSchema: z.object({
    submissionDeadline: z.string(),
    levels: z.record(z.string(), z.any()),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!isPwAdmin(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a Prabhupada World admin can set Ashraya-level targets' });
    }
    const saved = await saveAshrayaConfig(parseAshrayaConfig(input), context.user.id || context.user.userId || 'admin');
    return { success: true, ...saved };
  },
});
