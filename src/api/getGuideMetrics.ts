import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, Guides } from 'zite-integrations-backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Get guide overview metrics — pending approvals, submissions today, 7-day average',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const isSuperGuide = context.user.role === 'Super Guide';
    const todayStr = getTodayIST();
    const sevenDaysAgo = daysAgo(todayStr, 7);

    let guideDbId: string | null = null;
    if (!isSuperGuide) {
      const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
      if (!guide) return { pendingApprovals: 0, activeUsers: 0, submissionsToday: 0, missingToday: 0, avgScore7d: 0, submissionRate7d: 0 };
      guideDbId = (guide as any).id;
    }

    const userFilter: any = { status: 'Active' };
    if (guideDbId) userFilter.guide = guideDbId;

    const pendingFilter: any = { status: 'Pending Approval' };
    if (guideDbId) pendingFilter.guide = guideDbId;

    const [{ records: activeUsers }, { records: pendingUsers }, { records: todayEntries }, { records: weekEntries }] =
      await Promise.all([
        Users.findAll({ filters: userFilter, fields: ['id'], limit: 2000 }),
        Users.findAll({ filters: pendingFilter, fields: ['id'], limit: 500 }),
        SadhanaEntries.findAll({ filters: { entryDate: todayStr }, fields: ['id', 'user', 'scorePercent'], limit: 2000 }),
        SadhanaEntries.findAll({
          filters: { entryDate: { gte: sevenDaysAgo } as any },
          fields: ['id', 'user', 'scorePercent'], limit: 2000,
        }),
      ]);

    const activeUserIds = new Set(activeUsers.map((u: any) => u.id));
    const submissionsToday = todayEntries.filter((e: any) => {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      return activeUserIds.has(uid);
    }).length;

    const weekScores = weekEntries
      .filter((e: any) => activeUserIds.has(Array.isArray(e.user) ? e.user[0] : e.user))
      .map((e: any) => e.scorePercent ?? 0)
      .filter((s: number) => s > 0);

    const avgScore7d = weekScores.length > 0
      ? Math.round(weekScores.reduce((a: number, b: number) => a + b, 0) / weekScores.length)
      : 0;

    const totalPossible = activeUsers.length * 7;
    const submissionRate7d = totalPossible > 0
      ? parseFloat((weekEntries.filter((e: any) => activeUserIds.has(Array.isArray(e.user) ? e.user[0] : e.user)).length / totalPossible).toFixed(2))
      : 0;

    return {
      pendingApprovals: pendingUsers.length,
      activeUsers: activeUsers.length,
      submissionsToday,
      missingToday: Math.max(0, activeUsers.length - submissionsToday),
      avgScore7d,
      submissionRate7d,
    };
  },
});
