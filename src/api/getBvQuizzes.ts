import { z } from 'zod';
import { createEndpoint, BvQuizzes, BvQuizSubmissions } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get quizzes for a BV group, with submission counts',
  authenticated: true,
  inputSchema: z.object({
    groupId: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const { records: quizzes } = await BvQuizzes.findAll({
      filters: { group: input.groupId },
      limit: 100,
    });

    // Get submission counts per quiz
    const quizIds = quizzes.map(q => q.id);
    const { records: allSubs } = quizIds.length > 0
      ? await BvQuizSubmissions.findAll({
          filters: { quiz: { in: quizIds } },
          limit: 2000,
          fields: ['id', 'quiz', 'user', 'score', 'totalQuestions', 'percentage', 'submittedAt'],
        })
      : { records: [] };

    // My submissions
    const mySubMap = new Map<string, typeof allSubs[0]>();
    for (const sub of allSubs) {
      const qId = Array.isArray(sub.quiz) ? sub.quiz[0] : sub.quiz;
      const uId = Array.isArray(sub.user) ? sub.user[0] : sub.user;
      if (uId === context.user!.id && qId) {
        mySubMap.set(qId, sub);
      }
    }

    // Submission count per quiz
    const subCountMap = new Map<string, number>();
    for (const sub of allSubs) {
      const qId = Array.isArray(sub.quiz) ? sub.quiz[0] : sub.quiz;
      if (qId) subCountMap.set(qId, (subCountMap.get(qId) || 0) + 1);
    }

    const result = quizzes
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(q => {
        const questions = (() => {
          try { return JSON.parse(q.questionsJson || '[]'); } catch { return []; }
        })();
        const mySub = mySubMap.get(q.id);
        return {
          id: q.id,
          title: q.quizTitle || '',
          description: q.description || '',
          isActive: q.isActive || false,
          questionCount: questions.length,
          createdAt: q.createdAt || '',
          submissionCount: subCountMap.get(q.id) || 0,
          mySubmission: mySub ? {
            id: mySub.id,
            score: mySub.score ?? 0,
            totalQuestions: mySub.totalQuestions ?? 0,
            percentage: mySub.percentage ?? 0,
            submittedAt: mySub.submittedAt || '',
          } : null,
        };
      });

    return { quizzes: result };
  },
});
