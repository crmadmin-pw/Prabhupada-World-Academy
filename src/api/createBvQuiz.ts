import { z } from 'zod';
import { assertQuizDraftOwner, isQuizDraft } from '@/lib/quizPublication';
import { createEndpoint, BvQuizzes, AppError } from '@/lib/backend-sdk';
import {
  findScopedQuizGroup,
  getQuizGroupsForUser,
  isPwQuizContentManager,
  requireQuizContentManager,
  resolveQuizDepartment,
} from '@/lib/bvQuizAccess';

const questionSchema = z.object({
  id: z.coerce.string().min(1),
  text: z.string().trim().min(1),
  type: z.enum(['single', 'multiple']),
  options: z.array(z.coerce.string().trim().min(1)).min(2),
  correctAnswers: z.array(z.coerce.number().int().nonnegative()).min(1),
  explanation: z.string().optional(),
}).superRefine((question, context) => {
  if (question.type === 'single' && question.correctAnswers.length !== 1) {
    context.addIssue({ code: 'custom', path: ['correctAnswers'], message: 'Single-answer questions require exactly one correct answer' });
  }
  if (question.type === 'multiple' && question.correctAnswers.length < 2) {
    context.addIssue({ code: 'custom', path: ['correctAnswers'], message: 'Multiple-answer questions require at least two correct answers' });
  }
  if (new Set(question.correctAnswers).size !== question.correctAnswers.length) {
    context.addIssue({ code: 'custom', path: ['correctAnswers'], message: 'Correct answers must be unique' });
  }
  if (question.correctAnswers.some(index => index >= question.options.length)) {
    context.addIssue({ code: 'custom', path: ['correctAnswers'], message: 'Correct answer index is outside the option list' });
  }
});

const questionsSchema = z.array(questionSchema).min(1).max(500).superRefine((questions, context) => {
  const ids = questions.map(question => question.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Question IDs must be unique' });
  }
});

const draftQuestionsSchema = z.array(z.object({
  id: z.coerce.string().min(1).max(100),
  text: z.string().max(20000),
  type: z.enum(['single', 'multiple']),
  options: z.array(z.string().max(5000)).max(50),
  correctAnswers: z.array(z.coerce.number().int().nonnegative()).max(50),
  explanation: z.string().max(20000).optional(),
})).max(500);

export default createEndpoint({
  description: 'Create or update a department quiz',
  authenticated: true,
  inputSchema: z.object({
    quizId: z.string().optional(),
    department: z.enum(['FOLK', 'PW']).optional(),
    title: z.string().trim().max(200),
    description: z.string().optional(),
    groupId: z.string().optional(),
    questions: draftQuestionsSchema.optional(),
    publicationStatus: z.enum(['draft', 'published']).optional(),
    isActive: z.boolean().optional(),
    quizDate: z.string().optional(),
  }).superRefine((value, context) => {
    if (value.publicationStatus === 'draft') return;
    if (!value.title.trim()) context.addIssue({ code: 'custom', path: ['title'], message: 'A quiz title is required' });
    if (value.questions) {
      const checked = questionsSchema.safeParse(value.questions);
      if (!checked.success) for (const issue of checked.error.issues) {
        context.addIssue({ code: 'custom', path: ['questions', ...issue.path], message: issue.message });
      }
    }
    if (!value.quizId && !value.questions?.length) {
      context.addIssue({ code: 'custom', path: ['questions'], message: 'At least one question is required' });
    }
  }),
  outputSchema: z.object({ quizId: z.string(), success: z.boolean() }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    let existingQuiz: any = null;
    if (input.quizId) {
      existingQuiz = await BvQuizzes.findOne({ id: input.quizId });
      if (!existingQuiz) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz not found' });
      assertQuizDraftOwner(existingQuiz, context.user);
    }

    const draft = input.publicationStatus === 'draft';
    if (draft && existingQuiz && !isQuizDraft(existingQuiz)) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Published quizzes cannot be changed into drafts' });
    }
    const storedQuestions = input.questions ?? JSON.parse(existingQuiz?.questionsJson || '[]');
    if (!draft && (!input.title.trim() || !questionsSchema.safeParse(storedQuestions).success)) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'Complete the quiz title, questions, options and correct answers before publishing' });
    }
    const publication = { publicationStatus: draft ? 'draft' : 'published', isActive: draft ? false : (input.isActive ?? true) };

    const department = existingQuiz
      ? await resolveQuizDepartment(existingQuiz, input.department || 'FOLK')
      : (input.department || 'FOLK');
    if (input.department && input.department !== department) {
      throw new AppError({ code: 'FORBIDDEN', message: 'The quiz belongs to another department' });
    }

    if (department === 'PW') {
      if (!isPwQuizContentManager(context.user)) {
        throw new AppError({ code: 'FORBIDDEN', message: 'Only Prabhupada World admins can create quizzes' });
      }
      const questionsJson = JSON.stringify(storedQuestions);
      if (!questionsJson) throw new AppError({ code: 'BAD_REQUEST', message: 'At least one question is required' });
      const record = {
        quizTitle: input.title.trim() || 'Untitled Quiz',
        description: input.description || '',
        questionsJson,
        ...publication,
        quizDate: input.quizDate,
        department: 'PW',
        updatedAt: new Date().toISOString(),
      };
      if (input.quizId) {
        await BvQuizzes.update({ id: input.quizId, record });
        return { quizId: input.quizId, success: true };
      }
      const quiz = await BvQuizzes.create({
        record: {
          ...record,
          group: null,
          activeGroupIds: [],
          createdBy: context.user.id,
          createdAt: new Date().toISOString(),
        },
      });
      return { quizId: quiz.id, success: true };
    }

    if (department !== 'FOLK') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Only FOLK quizzes can be managed here' });
    }
    if (!draft && !input.questions?.length) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'At least one question is required' });
    }
    requireQuizContentManager(context.user, 'FOLK');

    const groups = await getQuizGroupsForUser(context.user, 'FOLK');
    const group = findScopedQuizGroup(groups, input.groupId || existingQuiz?.group);
    if (!group) {
      throw new AppError({ code: 'FORBIDDEN', message: 'You can manage quizzes only for your assigned FOLK groups' });
    }
    if (existingQuiz?.group && !findScopedQuizGroup([group], existingQuiz.group)) {
      throw new AppError({ code: 'FORBIDDEN', message: 'The quiz does not belong to the selected group' });
    }
    const groupId = group.id;

    const questionsJson = JSON.stringify(storedQuestions);
    if (input.quizId) {
      await BvQuizzes.update({
        id: input.quizId,
        record: {
          quizTitle: input.title.trim() || 'Untitled Quiz',
          description: input.description || '',
          questionsJson,
          ...publication,
          quizDate: input.quizDate,
          department: 'FOLK',
          updatedAt: new Date().toISOString(),
        },
      });
      return { quizId: input.quizId, success: true };
    }
    const quiz = await BvQuizzes.create({
      record: {
        quizTitle: input.title.trim() || 'Untitled Quiz',
        description: input.description || '',
        group: groupId,
        department: 'FOLK',
        createdBy: context.user.id,
        questionsJson,
        ...publication,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        quizDate: input.quizDate,
      },
    });
    return { quizId: quiz.id, success: true };
  },
});
