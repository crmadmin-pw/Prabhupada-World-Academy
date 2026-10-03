import { z } from 'zod';
import { AppError, BvQuizSubmissions, BvQuizzes, createEndpoint } from '@/lib/backend-sdk';
import {
  getUserQuizGroups,
  legacyQuizMatchesGroup,
  pwQuizEnabledForGroup,
  quizRefValues,
  quizUserDepartment,
  resolveQuizDepartment,
} from '@/lib/bvQuizAccess';

export default createEndpoint({
  description: 'Get the current user department-scoped BV quiz history and pending quizzes',
  authenticated: true,
  // `_nocache` is consumed by the browser endpoint SDK. Accept it here so the
  // quiz view can always revalidate group availability when it is opened.
  inputSchema: z.object({ _nocache: z.boolean().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    const department = quizUserDepartment(context.user);
    if (department !== 'FOLK' && department !== 'PW') {
      return {
        department: 'PW',
        submissions: [],
        quizDates: [],
        pendingQuizzes: [],
        stats: { totalTaken: 0, avgPercent: 0 },
      };
    }
    const groups = await getUserQuizGroups(context.user, department);

    const [{ records: allSubmissions }, { records: allQuizzes }] = await Promise.all([
      BvQuizSubmissions.findAll({
        limit: 5000,
        fields: ['id', 'user', 'userId', 'quiz', 'score', 'totalQuestions', 'percentage', 'submittedAt'],
      }),
      BvQuizzes.findAll({ limit: 500 }),
    ]);
    const userAliases = new Set(quizRefValues([
      context.user.id,
      context.user.userId,
      context.user.uid,
      context.user.email,
      context.user.fullName,
      context.user.name,
    ]));
    const ownSubmissions = allSubmissions.filter(submission =>
      quizRefValues([submission.user, submission.userId]).some(reference => userAliases.has(reference))
    );

    const quizDepartmentPairs = await Promise.all(allQuizzes.map(async quiz => ({
      quiz,
      department: await resolveQuizDepartment(quiz, department),
    })));
    const departmentQuizzes = quizDepartmentPairs
      .filter(pair => pair.department === department)
      .map(pair => pair.quiz);
    const quizById = new Map(departmentQuizzes.map(quiz => [String(quiz.id).toLowerCase(), quiz]));
    const submissions = ownSubmissions
      .map(submission => {
        const quizId = quizRefValues(submission.quiz)[0];
        const quiz = quizById.get(quizId || '');
        if (!quiz) return null;
        return {
          id: submission.id,
          quizId: quiz.id,
          quizTitle: quiz.quizTitle || 'Quiz',
          score: submission.score ?? 0,
          totalQuestions: submission.totalQuestions ?? 0,
          percentage: submission.percentage ?? 0,
          submittedAt: submission.submittedAt || '',
          submittedDate: submission.submittedAt ? String(submission.submittedAt).split('T')[0] : '',
        };
      })
      .filter((submission): submission is NonNullable<typeof submission> => submission !== null)
      .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const submittedQuizIds = new Set(submissions.map(submission => String(submission.quizId).toLowerCase()));

    const pendingQuizzes = departmentQuizzes
      .filter(quiz => quiz.isActive !== false && (department === 'FOLK' ? quiz.isActive === true : true))
      .filter(quiz => !submittedQuizIds.has(String(quiz.id).toLowerCase()))
      .filter(quiz => groups.some(group => department === 'PW' ? pwQuizEnabledForGroup(quiz, group) : legacyQuizMatchesGroup(quiz, group)))
      .map(quiz => {
        let questionCount = 0;
        try { questionCount = JSON.parse(quiz.questionsJson || '[]').length; } catch {}
        return {
          id: quiz.id,
          title: quiz.quizTitle || '',
          description: quiz.description || '',
          questionCount,
          quizDate: quiz.quizDate || '',
          createdAt: quiz.createdAt || '',
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const quizDates = submissions
      .map(submission => ({
        date: submission.submittedDate,
        percentage: submission.percentage,
        quizTitle: submission.quizTitle,
      }))
      .filter(entry => entry.date);
    const averagePercentage = submissions.length
      ? Math.round(submissions.reduce((sum, submission) => sum + submission.percentage, 0) / submissions.length)
      : 0;

    return {
      department,
      submissions,
      quizDates,
      pendingQuizzes,
      stats: {
        totalTaken: submissions.length,
        avgPercent: averagePercentage,
      },
    };
  },
});
