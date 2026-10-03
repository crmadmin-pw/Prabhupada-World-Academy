import { z } from 'zod';
import { createEndpoint, BvQuizzes, AppError } from '@/lib/backend-sdk';
import {
  findScopedQuizGroup,
  getQuizGroupsForUser,
  isPwQuizContentManager,
  isPwQuizFacilitator,
  readActiveGroupIds,
  resolveQuizDepartment,
  withGroupActivation,
} from '@/lib/bvQuizAccess';

export default createEndpoint({
  description: 'Turn a Prabhupada World quiz on or off for one reading group',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string().min(1),
    groupId: z.string().min(1),
    active: z.boolean(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    active: z.boolean(),
    activeGroupIds: z.array(z.string()),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    if (!isPwQuizContentManager(context.user) && !isPwQuizFacilitator(context.user)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only a Prabhupada World facilitator or admin can turn a quiz on for a group' });
    }

    const quiz = await BvQuizzes.findOne({ id: input.quizId });
    if (!quiz) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz not found' });
    if (await resolveQuizDepartment(quiz, 'PW') !== 'PW') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only Prabhupada World quizzes can be assigned to a group this way' });
    }
    if (quiz.isActive === false) {
      throw new AppError({ code: 'FORBIDDEN', message: 'This quiz is not published' });
    }

    const groups = await getQuizGroupsForUser(context.user, 'PW');
    const group = findScopedQuizGroup(groups, input.groupId);
    if (!group) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can change this quiz only for your own reading groups' });
    }

    const activeGroupIds = withGroupActivation(readActiveGroupIds(quiz), group.record, input.active);
    await BvQuizzes.update({
      id: input.quizId,
      record: {
        activeGroupIds,
        updatedAt: new Date().toISOString(),
      },
    });
    return { success: true, active: input.active, activeGroupIds };
  },
});
