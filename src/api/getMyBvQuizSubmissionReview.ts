import { z } from 'zod';
import { createEndpoint, AppError, BvQuizSubmissions, BvQuizzes } from '@/lib/backend-sdk';
import { quizRefValues, quizUserDepartment, resolveQuizDepartment } from '@/lib/bvQuizAccess';

export default createEndpoint({
  description: 'Get the current user\'s completed BV quiz with their answer review',
  authenticated: true,
  inputSchema: z.object({ submissionId: z.string().min(1) }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const department = quizUserDepartment(context.user);
    if (department !== 'FOLK' && department !== 'PW') {
      throw new AppError({ code: 'FORBIDDEN', message: 'Quizzes are not available for this account' });
    }

    // A result can only ever be reviewed by the user who submitted it.
    const submission = await BvQuizSubmissions.findOne({
      id: input.submissionId,
      fields: ['id', 'user', 'userId', 'quiz', 'department', 'score', 'totalQuestions', 'percentage', 'submittedAt', 'answersJson'],
    });
    const callerAliases = new Set(quizRefValues([
      context.user.id,
      context.user.userId,
      context.user.uid,
      context.user.email,
      context.user.fullName,
      context.user.name,
    ]));
    const ownsSubmission = !!submission && quizRefValues([submission.user, submission.userId]).some(reference => callerAliases.has(reference));
    if (!submission || !ownsSubmission) throw new AppError({ code: 'NOT_FOUND', message: 'Quiz submission not found' });

    const quizId = Array.isArray(submission.quiz) ? submission.quiz[0] : submission.quiz;
    const quiz = quizId ? await BvQuizzes.findOne({
      id: quizId as string,
      fields: ['id', 'quizTitle', 'description', 'department', 'isActive', 'createdAt', 'questionsJson'],
    }) : null;
    if (!quiz) throw new AppError({ code: 'NOT_FOUND', message: 'The original quiz is no longer available' });
    if (await resolveQuizDepartment(quiz, department) !== department) {
      throw new AppError({ code: 'NOT_FOUND', message: 'The original quiz is no longer available' });
    }

    let questions: any[] = [];
    let submittedAnswers: { questionId: string; selected: number[] }[] = [];
    try { questions = JSON.parse(quiz.questionsJson || '[]'); } catch {}
    try { submittedAnswers = JSON.parse(submission.answersJson || '[]'); } catch {}

    const results = questions.map((question: any) => {
      const selected = submittedAnswers.find(answer => answer.questionId === question.id)?.selected || [];
      const correct = Array.isArray(question.correctAnswers) ? question.correctAnswers : [];
      const isCorrect = question.type === 'single'
        ? selected.length === 1 && selected[0] === correct[0]
        : selected.length === correct.length &&
          selected.every((answer: number) => correct.includes(answer)) &&
          correct.every((answer: number) => selected.includes(answer));

      return {
        questionId: question.id,
        selected,
        correct,
        isCorrect,
        explanation: question.explanation || '',
      };
    });

    return {
      quiz: {
        id: quiz.id,
        title: quiz.quizTitle || '',
        description: quiz.description || '',
        isActive: !!quiz.isActive,
        createdAt: quiz.createdAt || '',
        questions: questions.map((question: any) => ({
          id: question.id,
          text: question.text || '',
          type: question.type || 'single',
          options: Array.isArray(question.options) ? question.options : [],
          explanation: question.explanation || '',
        })),
      },
      result: {
        score: submission.score ?? results.filter((result: any) => result.isCorrect).length,
        total: submission.totalQuestions ?? questions.length,
        percentage: submission.percentage ?? (questions.length ? Math.round((results.filter((result: any) => result.isCorrect).length / questions.length) * 100) : 0),
        submittedAt: submission.submittedAt || '',
        results,
      },
    };
  },
});
