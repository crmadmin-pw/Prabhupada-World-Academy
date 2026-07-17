import { z } from 'zod';
import { createEndpoint, BvQuizSubmissions, BvQuizzes, BvGroupMembers } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get the current user\'s BV quiz submission history and pending quizzes',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const uid = context.user!.id;

    // Get user's group membership
    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { user: uid },
      limit: 5,
      fields: ['id', 'group'],
    });
    const groupId = memberships.length > 0
      ? (Array.isArray(memberships[0].group) ? memberships[0].group[0] : memberships[0].group)
      : null;

    // Get user's submissions
    const { records: subs } = await BvQuizSubmissions.findAll({
      filters: { user: uid },
      limit: 100,
      fields: ['id', 'quiz', 'score', 'totalQuestions', 'percentage', 'submittedAt'],
    });

    const quizIds = [...new Set(subs.map(s => Array.isArray(s.quiz) ? s.quiz[0] : s.quiz).filter(Boolean))] as string[];
    const { records: quizzes } = quizIds.length > 0
      ? await BvQuizzes.findAll({ filters: { id: { in: quizIds } }, fields: ['id', 'quizTitle', 'createdAt'] })
      : { records: [] };
    const quizMap = new Map<string, typeof quizzes[0]>(quizzes.map(q => [q.id, q] as [string, typeof quizzes[0]]));

    // FIX: Always fetch pending quizzes regardless of submission history
    // Previously this was inside the subs.length === 0 block and skipped pending quizzes for users with no submissions
    let pendingQuizzes: any[] = [];
    if (groupId) {
      const { records: groupQuizzes } = await BvQuizzes.findAll({
        filters: { group: groupId, isActive: true },
        limit: 50,
        fields: ['id', 'quizTitle', 'questionsJson', 'createdAt'],
      });
      const submittedIds = new Set(quizIds);
      pendingQuizzes = groupQuizzes
        .filter(q => !submittedIds.has(q.id))
        .map(q => {
          let qCount = 0;
          try { qCount = JSON.parse(q.questionsJson || '[]').length; } catch {}
          return { id: q.id, title: q.quizTitle || '', questionCount: qCount, createdAt: q.createdAt || '' };
        });
    }

    if (subs.length === 0) {
      return { submissions: [], quizDates: [], pendingQuizzes, stats: { totalTaken: 0, avgPercent: 0 } };
    }

    const submissions = subs
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
      .map(s => {
        const qId = Array.isArray(s.quiz) ? s.quiz[0] : s.quiz;
        const quiz = quizMap.get(qId || '');
        return {
          id: s.id,
          quizId: qId || '',
          quizTitle: (quiz as any)?.quizTitle || 'Quiz',
          score: s.score ?? 0,
          totalQuestions: s.totalQuestions ?? 0,
          percentage: s.percentage ?? 0,
          submittedAt: s.submittedAt || '',
          submittedDate: s.submittedAt ? s.submittedAt.split('T')[0] : '',
        };
      });

    const quizDates = submissions.map(s => ({
      date: s.submittedDate,
      percentage: s.percentage,
      quizTitle: s.quizTitle,
    })).filter(d => d.date);

    const avgPercent = submissions.length > 0
      ? Math.round(submissions.reduce((s, sub) => s + sub.percentage, 0) / submissions.length)
      : 0;

    return {
      submissions,
      quizDates,
      pendingQuizzes,
      stats: { totalTaken: submissions.length, avgPercent },
    };
  },
});
