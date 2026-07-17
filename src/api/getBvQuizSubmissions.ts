import { z } from 'zod';
import { createEndpoint, BvQuizSubmissions, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get all submissions for a quiz (BVSL view)',
  authenticated: true,
  inputSchema: z.object({ quizId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const { records: subs } = await BvQuizSubmissions.findAll({
      filters: { quiz: input.quizId },
      limit: 500,
    });

    if (subs.length === 0) return { submissions: [] };

    const userIds = [...new Set(subs.map(s => (Array.isArray(s.user) ? s.user[0] : s.user)).filter(Boolean))] as string[];
    const { records: users } = await Users.findAll({
      filters: { id: { in: userIds } },
      fields: ['id', 'fullName', 'userId'],
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const submissions = subs
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
      .map(s => {
        const uid = Array.isArray(s.user) ? s.user[0] : s.user;
        const user = userMap.get(uid || '');
        return {
          id: s.id,
          userId: uid || '',
          userName: user?.fullName || 'Unknown',
          score: s.score ?? 0,
          totalQuestions: s.totalQuestions ?? 0,
          percentage: s.percentage ?? 0,
          submittedAt: s.submittedAt || '',
        };
      });

    return { submissions };
  },
});
