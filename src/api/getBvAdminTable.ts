import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, Users, Guides } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get BV attendance matrix table — members and attendance dates, scoped to a guide',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    // Resolve guide DB UUID (handle both UUID and custom ID)
    let guideDbId = input.guideId;
    if (guideDbId && !guideDbId.includes('-')) {
      const gr = await Guides.findOne({ filters: { guideId: guideDbId }, fields: ['id'] });
      if (gr) guideDbId = gr.id;
    }

    // Get active BV groups (filtered by guide if provided)
    const groupFilter: any = { isActive: true };
    if (guideDbId) groupFilter.guide = guideDbId;

    const { records: groups } = await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupId', 'groupName', 'bvslLeader'],
      limit: 200,
    });

    if (groups.length === 0) return { rows: [], dates: [] };

    const allGroupIds = groups.map((g: any) => g.id);

    // Get BVSL leader names
    const bvslIds = [...new Set(
      groups.map((g: any) => Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader).filter(Boolean) as string[]
    )];
    const bvslMap: Record<string, string> = {};
    if (bvslIds.length > 0) {
      const { records: bvslUsers } = await Users.findAll({
        filters: { id: { in: bvslIds } as any },
        fields: ['id', 'fullName'],
        limit: 200,
      });
      for (const u of bvslUsers) bvslMap[u.id] = u.fullName || '';
    }

    // Build group info map
    const groupInfoMap: Record<string, { groupName: string; bvslName: string }> = {};
    for (const g of groups) {
      const bvslId = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string | undefined;
      groupInfoMap[g.id] = {
        groupName: (g.groupName as string) || '',
        bvslName: bvslId ? (bvslMap[bvslId] || '') : '',
      };
    }

    // Get all memberships
    const { records: memberships } = await BvGroupMembers.findAll({
      filters: { group: { in: allGroupIds } as any },
      fields: ['id', 'user', 'group'],
      limit: 2000,
    });

    const memberUserIds = [...new Set(
      memberships.map((m: any) => (Array.isArray(m.user) ? m.user[0] : m.user)).filter(Boolean) as string[]
    )];

    // Lookup user details
    const userMap: Record<string, any> = {};
    if (memberUserIds.length > 0) {
      const { records: userRecords } = await Users.findAll({
        filters: { id: { in: memberUserIds } as any },
        fields: ['id', 'userId', 'fullName', 'ashrayLevel', 'residencyApproved', 'residency'],
        limit: 2000,
      });
      for (const u of userRecords) userMap[u.id] = u;
    }

    // Map each user to their group
    const userGroupMap: Record<string, string> = {};
    for (const m of memberships) {
      const uid = (Array.isArray(m.user) ? m.user[0] : m.user) as string;
      const gid = (Array.isArray(m.group) ? m.group[0] : m.group) as string;
      if (uid && gid) userGroupMap[uid] = gid;
    }

    // Get attendance for date range
    const attFilter: any = { group: { in: allGroupIds } as any };
    if (input.startDate || input.endDate) {
      const df: any = {};
      if (input.startDate) df.gte = input.startDate;
      if (input.endDate) df.lte = input.endDate;
      attFilter.attendanceDate = df;
    }

    let attRecords: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await BvAttendance.findAll({
        filters: attFilter,
        fields: ['id', 'user', 'present', 'attendanceDate'],
        limit: 2000,
        offset,
      });
      attRecords = attRecords.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    // Build date list
    const dates = [...new Set(
      attRecords.map((a: any) => a.attendanceDate).filter(Boolean)
    )].sort() as string[];

    // Build user → date → present map
    const userDateMap: Record<string, Record<string, number>> = {};
    for (const a of attRecords) {
      const uid = (Array.isArray(a.user) ? a.user[0] : a.user) as string;
      const date = a.attendanceDate as string;
      if (!uid || !date) continue;
      if (!userDateMap[uid]) userDateMap[uid] = {};
      userDateMap[uid][date] = a.present ? 1 : 0;
    }

    // Build matrix rows
    const rows = memberUserIds.map(uid => {
      const u = userMap[uid] as any;
      const gid = userGroupMap[uid];
      const groupInfo = gid ? groupInfoMap[gid] : { groupName: '', bvslName: '' };
      const attendance: Record<string, number> = {};
      dates.forEach(d => { attendance[d] = userDateMap[uid]?.[d] ?? 0; });
      const weekTotal = Object.values(attendance).reduce((s, v) => s + (v as number), 0);
      return {
        userId: u?.userId || uid || '',
        name: u?.fullName || '',
        ashrayLevel: u?.ashrayLevel || null,
        groupName: groupInfo?.groupName || '',
        bvslName: groupInfo?.bvslName || '',
        isResident: !!(u?.residencyApproved),
        residencyName: '',
        guideName: '',
        attendance,
        weekTotal,
      };
    });

    return { rows, dates };
  },
});
