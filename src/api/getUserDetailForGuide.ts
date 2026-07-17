import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, BvGroupMembers, BvGroups, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';
import { computeStreak, getTodayIST, daysAgo } from '../lib/streakUtils';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideScope, isUserInGuideScope } from '../lib/guideScope';

const USER_FIELDS = ['id', 'userId', 'fullName', 'phone', 'email', 'ashrayLevel', 'status',
  'residency', 'residencyApproved', 'createdAt', 'lastLoginAt', 'isBvsl', 'isSadhanaMentor',
  'currentStreak', 'lastStreakUpdatedAt', 'guide'];
const ENTRY_FIELDS = ['id', 'entryId', 'entryDate', 'totalScore', 'maxScore', 'scorePercent',
  'flagSick', 'flagOs', 'submittedAt'];

/** Resolve a user record by DB UUID or custom userId field (e.g. "USER-031") */
async function resolveUser(id: string) {
  const byId = await Users.findOne({ id, fields: USER_FIELDS }).catch(() => undefined);
  if (byId) return byId;
  return Users.findOne({ filters: { userId: id }, fields: USER_FIELDS });
}

/**
 * Check if a BVSL (identified by their DB record ID) has the target user
 * in any of their active BV groups.
 */
async function isBvslMember(bvslDbId: string, targetUserId: string): Promise<boolean> {
  const { records: bvslGroups } = await BvGroups.findAll({
    filters: { bvslLeader: bvslDbId, isActive: true },
    fields: ['id'],
    limit: 50,
  });
  if (bvslGroups.length === 0) return false;
  const groupIds = bvslGroups.map(g => g.id);
  const { records: memberships } = await BvGroupMembers.findAll({
    filters: { group: { in: groupIds }, user: targetUserId } as any,
    fields: ['id'],
    limit: 1,
  });
  return memberships.length > 0;
}

export default createEndpoint({
  description: 'Get detailed user data for guide view — with center-based access control',
  authenticated: true,
  inputSchema: z.object({ userId: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    if (!input.userId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'userId is required' });

    // Authorization: only guides, super guides, BVSLs, sadhana mentors, or BV Mentors can view user details
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: (context.user as any).isBvMentor,
    });

    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const isSuperGuide = context.user.role === 'Super Guide';

    const isBvMentor = !!(context.user as any).isBvMentor;

    if (!isSuperGuide && !isBvMentor) {
      // Try center-based scope (works for guides)
      const scope = await getGuideScope(context.user.email);

      if (scope) {
        // Caller has a guide record — enforce center-based access
        if (!isUserInGuideScope(scope, userRecord)) {
          throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only view users in your center' });
        }
      } else if (context.user.isBvsl) {
        // BVSL: check if the target user is in one of their BV groups
        const allowed = await isBvslMember(context.user.id, userRecord.id);
        if (!allowed) {
          throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only view members of your BV groups' });
        }
      } else if (context.user.isSadhanaMentor) {
        // Sadhana Mentors have a trusted role — allow access
        // (they are assigned by guides and oversee a subset of folk)
      } else {
        throw new ZiteError({ code: 'FORBIDDEN', message: 'Guide access required' });
      }
    }

    const residencyId = Array.isArray(userRecord.residency) ? userRecord.residency[0] : userRecord.residency;

    // Fetch last 100 days of entries + BV membership + residency in parallel
    const todayStr = getTodayIST();
    const streakStart = daysAgo(todayStr, 100);

    const [entriesRes, membershipRes, residencyRecord] = await Promise.all([
      SadhanaEntries.findAll({
        filters: { user: userRecord.id, entryDate: { gte: streakStart, lte: todayStr } } as any,
        fields: ENTRY_FIELDS,
        limit: 110,
      }),
      BvGroupMembers.findAll({ filters: { user: userRecord.id }, fields: ['id', 'group'], limit: 3 }),
      residencyId
        ? FolkResidencies.findOne({ id: residencyId as string, fields: ['id', 'residencyName'] })
        : Promise.resolve(null),
    ]);

    const sortedEntries = [...entriesRes.records].sort((a: any, b: any) =>
      ((b.entryDate as string) || '').localeCompare((a.entryDate as string) || '')
    );

    const scores = sortedEntries.map((e: any) => Math.min(100, e.scorePercent ?? 0)).filter((s: number) => s > 0);
    const avgScorePercent = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

    const streak = computeStreak(sortedEntries as any[], todayStr);

    let bvGroup: { groupId: string; groupName: string } | null = null;
    if (membershipRes.records.length > 0) {
      const gId = Array.isArray(membershipRes.records[0].group)
        ? membershipRes.records[0].group[0]
        : membershipRes.records[0].group;
      if (gId) {
        const g = await BvGroups.findOne({ id: gId as string, fields: ['id', 'groupId', 'groupName'] });
        if (g) bvGroup = { groupId: (g.groupId as string) || g.id, groupName: (g.groupName as string) || '' };
      }
    }

    // Also fetch guide name
    const guideId = Array.isArray(userRecord.guide) ? userRecord.guide[0] : userRecord.guide;
    let guideName: string | null = null;
    if (guideId) {
      const { records: guides } = await Users.findAll({
        filters: { id: guideId } as any,
        fields: ['id', 'fullName'],
        limit: 1,
      });
      guideName = guides[0]?.fullName as string || null;
    }

    return {
      user: {
        userId: (userRecord.userId as string) || userRecord.id,
        dbId: userRecord.id,
        fullName: (userRecord.fullName as string) || '',
        phone: userRecord.phone || '',
        email: (userRecord.email as string) || '',
        ashrayLevel: (userRecord.ashrayLevel as string) || null,
        status: (userRecord.status as string) || 'Active',
        residencyName: (residencyRecord as any)?.residencyName || null,
        isResident: !!(userRecord.residencyApproved && residencyId),
        createdAt: (userRecord.createdAt as string) || '',
        lastLoginAt: (userRecord.lastLoginAt as string) || null,
        isBvsl: !!(userRecord.isBvsl),
        isSadhanaMentor: !!(userRecord.isSadhanaMentor),
        guideName,
      },
      metrics: {
        currentStreak: streak,
        totalEntries: sortedEntries.length,
        avgScorePercent,
        weeklyAvgScore: 0,
      },
      recentEntries: sortedEntries.slice(0, 45).map((e: any) => ({
        entryId: (e.entryId as string) || e.id,
        rowId: e.id,
        entryDate: (e.entryDate as string) || '',
        totalScore: (e.totalScore as number) ?? 0,
        maxScore: (e.maxScore as number) ?? 0,
        scorePercent: (e.scorePercent as number) ?? null,
        flagSick: !!(e.flagSick),
        flagOs: !!(e.flagOs),
        submittedAt: (e.submittedAt as string) || '',
      })),
      bvGroup,
    };
  },
});
