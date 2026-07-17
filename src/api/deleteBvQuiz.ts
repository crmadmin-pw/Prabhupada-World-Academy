import { z } from 'zod';
import { createEndpoint, BvQuizzes, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Delete a BV quiz',
  authenticated: true,
  inputSchema: z.object({ quizId: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!context.user.isBvsl && context.user.role !== 'BVSL') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only BVSL can delete quizzes' });
    }
    await BvQuizzes.delete({ id: input.quizId });
    return { success: true };
  },
});
