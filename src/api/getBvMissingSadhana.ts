import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, Users, Guides, SadhanaEntries } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export default createEndpoint({
  description: 'BV Mentor missing sadhana report — per-member gaps in a date range, across all BV groups under a guide',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    requireGuideRole(context.user?.role, {
      isSadhanaMentor: context.user?.isSadhanaMentor,
      isBvsl: context.user?.isBvsl,
      isBvMentor: context.user?.isBvMentor,
    });

    // ── 1. Resolve guideId to Guides-table UUID ──────────────────────────────
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
    if (!guideDbId) return { members: [], groups: [], bvsls: [] };

    // ── 2. Fetch active BV groups under this guide ───────────────────────────
    const { records: groups } = await BvGroups.findAll({
      filters: { guide: guideDbId, isActive: true },
      fields: ['id', 'groupName', 'bvslLeader'],
      limit: 200,
    });
    if (groups.length === 0) return { members: [], groups: [], bvsls: [] };

    // ── 3. Fetch BVSL leader info ────────────────────────────────────────────
    const bvslLeaderIds = [...new Set(
      groups.map(g => (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string).filter(Boolean)
    )];
    const bvslMap: Record<string, string> = {};
    if (bvslLeaderIds.length > 0) {
      const { records: bvslUsers } = await Users.findAll({
        filters: { id: { in: bvslLeaderIds } as any },
        fields: ['id', 'fullName'],
        limit: 200,
      });
      for (const u of bvslUsers) bvslMap[u.id] = u.fullName || '';
    }

    // ── 4. Fetch all group memberships ───────────────────────────────────────
    const groupDbIds = groups.map(g => g.id);
    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { group: { in: groupDbIds } as any },
      fields: ['user', 'group'],
      limit: 2000,
    });

    const allMemberUserIds = [...new Set(
      memberships.map(m => (Array.isArray(m.user) ? m.user[0] : m.user) as string).filter(Boolean)
    )];

    if (allMemberUserIds.length === 0) {
      const groupsList = groups.map(g => ({ id: g.id, name: g.groupName || '' }));
      const bvslsList = bvslLeaderIds.map(id => ({ id, name: bvslMap[id] || '' }));
      return { members: [], groups: groupsList, bvsls: bvslsList };
    }

    // ── 5. Fetch member user records (both Active and Inactive) ──────────────
    const { records: memberUsers } = await Users.findAll({
      filters: { id: { in: allMemberUserIds } as any },
      fields: ['id', 'fullName', 'phone', 'email', 'status'],
      limit: 2000,
    });
    const userInfoMap: Record<string, { fullName: string; phone: string; email: string; status: string }> = {};
    for (const u of memberUsers) {
      userInfoMap[u.id] = {
        fullName: u.fullName || '',
        phone: u.phone || '',
        email: u.email || '',
        status: (u.status as string) || 'Unknown',
      };
    }

    // ── 6. Fetch sadhana entries in date range ───────────────────────────────
    const { records: entries } = await SadhanaEntries.findAll({
      filters: {
        entryDate: { gte: input.startDate, lte: input.endDate } as any,
        user: { in: allMemberUserIds } as any,
      },
      fields: ['user', 'entryDate', 'submittedAt'],
      limit: 10000,
    });

    // Build per-user entry map
    const userEntryMap: Record<string, Array<{ entryDate: string; submittedAt: string | null }>> = {};
    for (const e of entries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid) continue;
      if (!userEntryMap[uid]) userEntryMap[uid] = [];
      userEntryMap[uid].push({
        entryDate: (e.entryDate as string) || '',
        submittedAt: (e.submittedAt as string | null) || null,
      });
    }

    // ── 7. Compute date range ────────────────────────────────────────────────
    const datesInRange = getDatesInRange(input.startDate, input.endDate);
    const totalDays = datesInRange.length;
    const datesSet = new Set(datesInRange);

    // ── 8. Build per-group membership map ────────────────────────────────────
    const groupMembershipsMap: Record<string, string[]> = {};
    for (const m of memberships) {
      const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
      const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
      if (gid && uid) {
        if (!groupMembershipsMap[gid]) groupMembershipsMap[gid] = [];
        groupMembershipsMap[gid].push(uid);
      }
    }

    // ── 9. Build member result rows ──────────────────────────────────────────
    const members: any[] = [];
    for (const group of groups) {
      const bvslId = (Array.isArray(group.bvslLeader) ? group.bvslLeader[0] : group.bvslLeader) as string | undefined;
      const bvslName = bvslId ? (bvslMap[bvslId] || '') : '';
      const memberIds = groupMembershipsMap[group.id] || [];

      for (const uid of memberIds) {
        const userInfo = userInfoMap[uid];
        if (!userInfo) continue;

        const userEntries = userEntryMap[uid] || [];
        const filledDates = new Set(
          userEntries.map(e => e.entryDate).filter(d => datesSet.has(d))
        );

        const missingDays = totalDays - filledDates.size;
        const sortedFilled = [...filledDates].sort();
        const lastFilledDate = sortedFilled.length > 0 ? sortedFilled[sortedFilled.length - 1] : null;

        let lateDays = 0;
        for (const e of userEntries) {
          if (!datesSet.has(e.entryDate)) continue;
          if (e.submittedAt) {
            const submittedDate = String(e.submittedAt).split('T')[0];
            if (submittedDate > e.entryDate) lateDays++;
          }
        }

        const fillRate = totalDays > 0 ? Math.round((filledDates.size / totalDays) * 100) : 0;

        members.push({
          userId: uid,
          fullName: userInfo.fullName,
          phone: userInfo.phone,
          email: userInfo.email,
          status: userInfo.status,
          groupName: group.groupName || '',
          groupId: group.id,
          bvslName,
          bvslId: bvslId || '',
          missingDays,
          lateDays,
          lastFilledDate,
          totalDays,
          fillRate,
        });
      }
    }

    // ── 10. Return flat lists ────────────────────────────────────────────────
    const groupsList = groups.map(g => ({ id: g.id, name: g.groupName || '' }));
    const bvslsList = bvslLeaderIds
      .map(id => ({ id, name: bvslMap[id] || '' }))
      .filter(b => b.name);

    return { members, groups: groupsList, bvsls: bvslsList };
  },
});
