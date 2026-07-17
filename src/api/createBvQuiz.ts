import { z } from 'zod';
import { createEndpoint, BvQuizzes, ZiteError } from 'zite-integrations-backend-sdk';

const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(['single', 'multiple']),
  options: z.array(z.string()),
  correctAnswers: z.array(z.number()),
  explanation: z.string().optional(),
});

export default createEndpoint({
  description: 'Create or update a BV quiz for a group',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    groupId: z.string(),
    questions: z.array(questionSchema),
    isActive: z.boolean().optional(),
    quizDate: z.string().optional(),
  }),
  outputSchema: z.object({ quizId: z.string(), success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!context.user.isBvsl && context.user.role !== 'BVSL') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only BVSL can create quizzes' });
    }
    const questionsJson = JSON.stringify(input.questions);
    if (input.quizId) {
      await BvQuizzes.update({
        id: input.quizId,
        record: {
          quizTitle: input.title,
          description: input.description || '',
          questionsJson,
          isActive: input.isActive ?? true,
          quizDate: input.quizDate,
        },
      });
      return { quizId: input.quizId, success: true };
    }
    const quiz = await BvQuizzes.create({
      record: {
        quizTitle: input.title,
        description: input.description || '',
        group: input.groupId,
        createdBy: context.user.id,
        questionsJson,
        isActive: input.isActive ?? true,
        createdAt: new Date().toISOString(),
        quizDate: input.quizDate,
      },
    });
    return { quizId: quiz.id, success: true };
  },
});
