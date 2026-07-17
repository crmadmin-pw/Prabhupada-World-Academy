import { z } from 'zod';
import { createEndpoint, AttendanceSessions, ChallengeEnrollments } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get challenge dashboard summary for Guides/Super Guides',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    challenges: z.array(z.object({
      sessionId: z.string(),
      name: z.string(),
      challengeTitle: z.string(),
      challengeDays: z.number(),
      enrolledCount: z.number(),
      activeCount: z.number(),
      completedCount: z.number(),
      droppedCount: z.number(),
      completionRate: z.number(),
      avgStreak: z.number(),
    })),
  }),
  execute: async ({ input, context }) => {
    // Fetch all sessions with challenges enabled
    const { records: sessions } = await AttendanceSessions.findAll({
      filters: { challengeEnabled: true },
      limit: 100,
    });

    if (sessions.length === 0) return { challenges: [] };

    // Fetch all enrollments for these sessions
    const { records: enrollments } = await ChallengeEnrollments.findAll({
      filters: { session: { in: sessions.map(s => s.id) } },
      limit: 2000,
    });

    // Group enrollments by session
    const enrollmentsBySession = new Map<string, typeof enrollments>();
    for (const e of enrollments) {
      const sid = Array.isArray(e.session) ? e.session[0] : e.session;
      if (!sid) continue;
      const arr = enrollmentsBySession.get(sid) || [];
      arr.push(e);
      enrollmentsBySession.set(sid, arr);
    }

    const challenges = sessions.map(s => {
      const enrs = enrollmentsBySession.get(s.id) || [];
      const active = enrs.filter(e => e.status === 'Active').length;
      const completed = enrs.filter(e => e.status === 'Completed').length;
      const dropped = enrs.filter(e => e.status === 'Dropped').length;
      const totalStreaks = enrs.reduce((sum, e) => sum + (e.currentStreak || 0), 0);

      return {
        sessionId: s.id,
        name: s.name || '',
        challengeTitle: s.challengeTitle || `${s.challengeDays || 7}-Day Challenge`,
        challengeDays: s.challengeDays || 7,
        enrolledCount: enrs.length,
        activeCount: active,
        completedCount: completed,
        droppedCount: dropped,
        completionRate: enrs.length > 0 ? Math.round((completed / enrs.length) * 100) : 0,
        avgStreak: enrs.length > 0 ? Math.round((totalStreaks / enrs.length) * 10) / 10 : 0,
      };
    });

    // Sort: active challenges first, then by enrollment count
    challenges.sort((a, b) => (b.activeCount > 0 ? 1 : 0) - (a.activeCount > 0 ? 1 : 0) || b.enrolledCount - a.enrolledCount);

    return { challenges };
  },
});
