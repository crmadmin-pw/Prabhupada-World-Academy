import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, Guides, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';

const EMPTY_SUMMARY = { totalGroups: 0, totalMembers: 0, filledToday: 0, pendingToday: 0, fillRate: 0, weeklyAvgRate: 0 };

export default createEndpoint({
  description: 'Center-like sadhana monitoring per BV group — fill rates, streaks, pending members',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string(), date: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const targetDate = input.date || getTodayIST();
    const sevenDaysAgo = daysAgo(targetDate, 6);

    // --- Resolve guide ID (Guides-table UUID) ---
    let guideDbId: string | null = null;
    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] }).catch(() => undefined);
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] }).catch(() => undefined);
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] }).catch(() => undefined);
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] }).catch(() => undefined);
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }
    if (!guideDbId) return { targetDate, summary: EMPTY_SUMMARY, groups: [] };

    // --- Fetch active BV groups under this guide ---
    const { records: groups } = await BvGroups.findAll({
      filters: { guide: guideDbId, isActive: true },
      fields: ['id', 'groupId', 'groupName', 'bvslLeader'],
      limit: 200,
    });
    if (groups.length === 0) return { targetDate, summary: { ...EMPTY_SUMMARY, totalGroups: 0 }, groups: [] };

    // --- Fetch BVSL leader info ---
    const bvslLeaderIds = [...new Set(
      groups.map(g => (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string).filter(Boolean)
    )];
    const bvslMap: Record<string, { fullName: string; phone: string }> = {};
    if (bvslLeaderIds.length > 0) {
      const { records: bvslUsers } = await Users.findAll({
        filters: { id: { in: bvslLeaderIds } as any },
        fields: ['id', 'fullName', 'phone'],
        limit: 200,
      });
      for (const u of bvslUsers) bvslMap[u.id] = { fullName: u.fullName || '', phone: u.phone || '' };
    }

    // --- Fetch all group memberships ---
    const groupDbIds = groups.map(g => g.id);
    const { records: allMemberships } = await BvGroupMembers.findAll({
      filters: { group: { in: groupDbIds } as any },
      fields: ['user', 'group'],
      limit: 2000,
    });

    const allMemberUserIds = [...new Set(
      allMemberships.map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string).filter(Boolean)
    )];

    // --- Build empty group shells if no members ---
    if (allMemberUserIds.length === 0) {
      return {
        targetDate,
        summary: { ...EMPTY_SUMMARY, totalGroups: groups.length },
        groups: groups.map(g => {
          const bvslId = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string | undefined;
          const bvslInfo = bvslId ? bvslMap[bvslId] : null;
          return {
            groupId: g.groupId || g.id,
            groupDbId: g.id,
            groupName: g.groupName || '',
            bvslName: bvslInfo?.fullName || '',
            bvslPhone: bvslInfo?.phone || '',
            memberCount: 0, filledCount: 0, pendingCount: 0, fillPercent: 0, weeklyAvgPercent: 0, members: [],
          };
        }),
      };
    }

    // --- Fetch member user info ---
    const { records: memberUsers } = await Users.findAll({
      filters: { id: { in: allMemberUserIds } as any },
      fields: ['id', 'fullName', 'currentStreak'],
      limit: 2000,
    });
    const userInfoMap: Record<string, { fullName: string; currentStreak: number }> = {};
    for (const u of memberUsers) userInfoMap[u.id] = { fullName: u.fullName || '', currentStreak: u.currentStreak ?? 0 };

    // --- Fetch sadhana entries SCOPED to BV group members only ---
    // This prevents hitting the global 2000-record limit and ensures accuracy
    const [{ records: todayEntries }, { records: weekEntries }] = await Promise.all([
      SadhanaEntries.findAll({
        filters: { entryDate: targetDate, user: { in: allMemberUserIds } as any },
        fields: ['user', 'entryDate'],
        limit: 2000,
      }),
      SadhanaEntries.findAll({
        filters: { entryDate: { gte: sevenDaysAgo, lte: targetDate } as any, user: { in: allMemberUserIds } as any },
        fields: ['user', 'entryDate'],
        limit: 2000,
      }),
    ]);

    // Entries are already scoped to BV members — no need for extra .includes() checks
    const filledTodaySet = new Set(
      todayEntries.map(e => (Array.isArray(e.user) ? e.user[0] : e.user) as string).filter(Boolean)
    );

    const userFilledDates: Record<string, Set<string>> = {};
    for (const e of weekEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid) continue;
      if (!userFilledDates[uid]) userFilledDates[uid] = new Set();
      if (e.entryDate) userFilledDates[uid].add(e.entryDate as string);
    }

    // --- Build per-group membership map ---
    const groupMembershipsMap: Record<string, string[]> = {};
    for (const m of allMemberships) {
      const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
      const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
      if (gid && uid) {
        if (!groupMembershipsMap[gid]) groupMembershipsMap[gid] = [];
        groupMembershipsMap[gid].push(uid);
      }
    }

    // --- Compute per-group stats ---
    const groupResults = groups.map(g => {
      const bvslId = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string | undefined;
      const bvslInfo = bvslId ? bvslMap[bvslId] : null;
      const memberIds = groupMembershipsMap[g.id] || [];
      const filledCount = memberIds.filter(uid => filledTodaySet.has(uid)).length;
      const fillPercent = memberIds.length > 0 ? Math.round((filledCount / memberIds.length) * 100) : 0;

      let weeklyAvgPercent = 0;
      if (memberIds.length > 0) {
        let total = 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date(targetDate + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - (6 - i));
          const ds = d.toISOString().split('T')[0];
          total += memberIds.filter(uid => userFilledDates[uid]?.has(ds)).length / memberIds.length;
        }
        weeklyAvgPercent = Math.round((total / 7) * 100);
      }

      const members = memberIds.map(uid => {
        const info = userInfoMap[uid] || { fullName: 'Unknown', currentStreak: 0 };
        const filledDates = [...(userFilledDates[uid] || [])].sort().reverse();
        return {
          userId: uid,
          fullName: info.fullName,
          filledToday: filledTodaySet.has(uid),
          currentStreak: info.currentStreak,
          lastFilledDate: filledDates[0] || null,
        };
      });

      return {
        groupId: g.groupId || g.id,
        groupDbId: g.id,
        groupName: g.groupName || '',
        bvslName: bvslInfo?.fullName || '',
        bvslPhone: bvslInfo?.phone || '',
        memberCount: memberIds.length,
        filledCount,
        pendingCount: memberIds.length - filledCount,
        fillPercent,
        weeklyAvgPercent,
        members,
      };
    });

    // --- Aggregate summary ---
    const totalMembers = groupResults.reduce((s, g) => s + g.memberCount, 0);
    const totalFilled = groupResults.reduce((s, g) => s + g.filledCount, 0);
    const fillRate = totalMembers > 0 ? Math.round((totalFilled / totalMembers) * 100) : 0;
    const weeklyAvgRate = groupResults.length > 0
      ? Math.round(groupResults.reduce((s, g) => s + g.weeklyAvgPercent, 0) / groupResults.length)
      : 0;

    return {
      targetDate,
      summary: { totalGroups: groups.length, totalMembers, filledToday: totalFilled, pendingToday: totalMembers - totalFilled, fillRate, weeklyAvgRate },
      groups: groupResults,
    };
  },
});
