import { z } from 'zod';
import { createEndpoint, BvQuizzes, AppError } from '@/lib/backend-sdk';
import {
  assertQuizParticipantAccess,
  findScopedQuizGroup,
  getQuizGroupsForUser,
  isPwQuizContentManager,
  requireQuizContentManager,
  resolveQuizDepartment,
} from '@/lib/bvQuizAccess';

export default createEndpoint({
  description: 'Get an authorized BV quiz for participation or content editing',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string(),
    department: z.enum(['FOLK', 'PW']).optional(),
    includeAnswers: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const quiz = await BvQuizzes.findOne({ id: input.quizId });
    if (!quiz) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz not found' });

    const department = await resolveQuizDepartment(quiz, input.department || 'FOLK');
    if (department !== 'FOLK' && department !== 'PW') {
      throw new AppError({ code: 'FORBIDDEN', message: 'This quiz is not available' });
    }

    if (input.includeAnswers) {
      if (department === 'PW') {
        if (!isPwQuizContentManager(context.user)) {
          throw new AppError({ code: 'FORBIDDEN', message: 'Only Prabhupada World admins can edit quizzes' });
        }
      } else {
        requireQuizContentManager(context.user, 'FOLK');
        const groups = await getQuizGroupsForUser(context.user, 'FOLK');
        if (!findScopedQuizGroup(groups, quiz.group)) {
          throw new AppError({ code: 'FORBIDDEN', message: 'You can edit quizzes only for your assigned FOLK groups' });
        }
      }
    } else {
      await assertQuizParticipantAccess(context.user, quiz, department);
    }

    let questions: any[] = [];
    try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}

    return {
      id: quiz.id,
      title: quiz.quizTitle || '',
      description: quiz.description || '',
      department,
      isActive: quiz.isActive === true,
      quizDate: quiz.quizDate || '',
      createdAt: quiz.createdAt || '',
      questions: questions.map((q: any) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        options: q.options,
        explanation: input.includeAnswers ? (q.explanation || '') : '',
        ...(input.includeAnswers ? { correctAnswers: Array.isArray(q.correctAnswers) ? q.correctAnswers : [] } : {}),
      })),
    };
  },
});
