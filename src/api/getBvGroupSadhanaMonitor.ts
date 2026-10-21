import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, Guides, SadhanaEntries } from '@/lib/backend-sdk';
import { getTodayIST, daysAgo } from '../lib/streakUtils';
import { assignedStaffSlots, joinFacilitatorNames, textList } from '@/lib/bvGroupFacilitators';
import { isExcusedFromReporting } from '@/lib/accountDeletionPolicy';

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
    const directGuideRec = await Guides.findOne({ id: input.guideId, fields: ['id'] });
    if (directGuideRec) {
      guideDbId = directGuideRec.id;
    } else {
      const guideUser = await Users.findOne({ id: input.guideId, fields: ['id', 'email'] });
      if (guideUser?.email) {
        const guideByEmail = await Guides.findOne({ filters: { email: guideUser.email }, fields: ['id'] });
        if (guideByEmail) guideDbId = guideByEmail.id;
      }
      if (!guideDbId) {
        const guideByCustomId = await Guides.findOne({ filters: { guideId: input.guideId }, fields: ['id'] });
        if (guideByCustomId) guideDbId = guideByCustomId.id;
      }
    }
    if (!guideDbId) return { targetDate, summary: EMPTY_SUMMARY, groups: [] };

    // --- Fetch active BV groups under this guide ---
    const { records: groups } = await BvGroups.findAll({
      filters: { guide: guideDbId, isActive: true },
      fields: ['id', 'groupId', 'groupName', 'bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator'],
      limit: 200,
    });
    if (groups.length === 0) return { targetDate, summary: { ...EMPTY_SUMMARY, totalGroups: 0 }, groups: [] };

    // --- Fetch BVSL leader info ---
    const bvslLeaderIds = [...new Set(
      groups.flatMap(g => assignedStaffSlots(g).flatMap(slot => slot.keys))
    )];
    const bvslMap: Record<string, { fullName: string; phone: string }> = {};
    const groupDbIds = groups.map(g => g.id);
    const [bvslUsers, { records: allMemberships }] = await Promise.all([
      bvslLeaderIds.length > 0
        ? Users.findAll({
          filters: { id: { in: bvslLeaderIds } as any },
          fields: ['id', 'fullName', 'phone'],
          limit: 200,
        }).then(result => result.records)
        : Promise.resolve([] as any[]),
      // --- Fetch all group memberships ---
      BvGroupMembers.findAll({
        filters: { group: { in: groupDbIds } as any },
        fields: ['user', 'group'],
        limit: 2000,
      }),
    ]);
    for (const u of bvslUsers) bvslMap[u.id] = { fullName: u.fullName || '', phone: u.phone || '' };

    const allMemberUserIds = [...new Set([
      ...allMemberships.map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string).filter(Boolean),
      ...bvslLeaderIds,
    ])];

    // --- Build empty group shells if no members ---
    if (allMemberUserIds.length === 0) {
      return {
        targetDate,
        summary: { ...EMPTY_SUMMARY, totalGroups: groups.length },
        groups: groups.map(g => {
          const bvslPeople = textList(g.bvslLeader).map(id => bvslMap[id]).filter(Boolean);
          const bvslInfo = bvslPeople[0];
          return {
            groupId: g.groupId || g.id,
            groupDbId: g.id,
            groupName: g.groupName || '',
            bvslName: joinFacilitatorNames(bvslPeople.map(person => person.fullName)),
            bvslPhone: bvslInfo?.phone || '',
            memberCount: assignedStaffSlots(g).length,
            filledCount: 0,
            pendingCount: assignedStaffSlots(g).length,
            fillPercent: 0,
            weeklyAvgPercent: 0,
            members: assignedStaffSlots(g).map(slot => ({
              userId: slot.keys[0],
              fullName: bvslMap[slot.keys[0]]?.fullName || slot.keys[0],
              filledToday: false,
              currentStreak: 0,
              lastFilledDate: null,
            })),
          };
        }),
      };
    }

    // --- Fetch member user info ---
    // --- Fetch sadhana entries SCOPED to BV group members only ---
    // This prevents hitting the global 2000-record limit and ensures accuracy
    const [{ records: memberUsers }, { records: todayEntries }, { records: weekEntries }] = await Promise.all([
      Users.findAll({
        filters: { id: { in: allMemberUserIds } as any },
        fields: ['id', 'fullName', 'currentStreak', 'status'],
        limit: 2000,
      }),
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
    const userInfoMap: Record<string, { fullName: string; currentStreak: number }> = {};
    const excusedMemberIds = new Set<string>();
    for (const u of memberUsers) {
      if (isExcusedFromReporting(u.status)) {
        excusedMemberIds.add(u.id);
        continue;
      }
      userInfoMap[u.id] = { fullName: u.fullName || '', currentStreak: u.currentStreak ?? 0 };
    }
    for (const [id, person] of Object.entries(bvslMap)) {
      if (!userInfoMap[id]) userInfoMap[id] = { fullName: person.fullName, currentStreak: 0 };
    }

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
      const bvslPeople = textList(g.bvslLeader).map(id => bvslMap[id]).filter(Boolean);
      const bvslInfo = bvslPeople[0];
      const memberIds = [...(groupMembershipsMap[g.id] || [])];
      const seenMemberIds = new Set(memberIds.map(id => id.toLowerCase()));
      for (const slot of assignedStaffSlots(g)) {
        if (slot.keys.some(key => seenMemberIds.has(key.toLowerCase()))) {
          slot.keys.forEach(key => seenMemberIds.add(key.toLowerCase()));
          continue;
        }
        const resolved = slot.keys.find(key => userInfoMap[key]);
        if (!resolved || seenMemberIds.has(resolved.toLowerCase())) continue;
        memberIds.push(resolved);
        slot.keys.forEach(key => seenMemberIds.add(key.toLowerCase()));
      }
      const activeMemberIds = memberIds.filter(uid => uid && !excusedMemberIds.has(uid));
      const filledCount = activeMemberIds.filter(uid => filledTodaySet.has(uid)).length;
      const fillPercent = activeMemberIds.length > 0 ? Math.round((filledCount / activeMemberIds.length) * 100) : 0;

      let weeklyAvgPercent = 0;
      if (activeMemberIds.length > 0) {
        let total = 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date(targetDate + 'T00:00:00Z');
          d.setUTCDate(d.getUTCDate() - (6 - i));
          const ds = d.toISOString().split('T')[0];
          total += activeMemberIds.filter(uid => userFilledDates[uid]?.has(ds)).length / activeMemberIds.length;
        }
        weeklyAvgPercent = Math.round((total / 7) * 100);
      }

      const members = activeMemberIds.map(uid => {
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
        bvslName: joinFacilitatorNames(bvslPeople.map(person => person.fullName)),
        bvslPhone: bvslInfo?.phone || '',
        memberCount: activeMemberIds.length,
        filledCount,
        pendingCount: activeMemberIds.length - filledCount,
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
