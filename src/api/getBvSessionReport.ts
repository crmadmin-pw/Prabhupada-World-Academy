import { z } from 'zod';
import { createEndpoint, Users, BvGroups, BvSessions, BvAttendance, BvGroupMembers } from '@/lib/backend-sdk';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideIdsForResidencies } from '../lib/guideScope';
import { joinFacilitatorNames, textList } from '@/lib/bvGroupFacilitators';

export default createEndpoint({
  description: 'BV session/attendance report for guide — attendance by group+date with session topic/notes from BvSessions',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    groupId: z.string().optional(),
    residencyIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor: (context.user as any).isBvMentor });

    const { startDate, endDate, groupId } = input;
    let guideDbId: string | null = input.guideId === 'ALL' ? null : input.guideId;

    // Get groups under this guide (or all guides in center if residencyIds provided)
    const groupFilter: any = { isActive: true };
    if (input.residencyIds && input.residencyIds.length > 0) {
      const allGuideIds = await getGuideIdsForResidencies(input.residencyIds);
      if (allGuideIds.length > 0) {
        groupFilter.guide = { in: allGuideIds };
      } else if (guideDbId) {
        groupFilter.guide = guideDbId;
      }
    } else if (guideDbId) {
      groupFilter.guide = guideDbId;
    }
    if (groupId) groupFilter.id = groupId;

    const { records: groups } = await BvGroups.findAll({
      filters: groupFilter,
      fields: ['id', 'groupName', 'bvslLeader'],
      limit: 200,
    });

    if (groups.length === 0) return { sessions: [], groups: [] };

    const groupIds = groups.map(g => g.id);
    const groupMap = new Map(groups.map(g => [g.id, g]));

    // Get BVSL leader names
    const bvslIds = new Set<string>();
    for (const g of groups) {
      textList(g.bvslLeader).forEach(lid => bvslIds.add(lid));
    }
    const bvslNameMap = new Map<string, string>();
    const loadAttendance = async () => {
      let rows: any[] = [];
      let attOff = 0;
      while (true) {
        const { records, hasMore } = await BvAttendance.findAll({
          filters: {
            group: { in: groupIds },
            attendanceDate: { gte: startDate, lte: endDate },
          } as any,
          fields: ['id', 'group', 'user', 'present', 'attendanceDate'],
          limit: 2000,
          offset: attOff,
        });
        rows = rows.concat(records);
        if (!hasMore) break;
        attOff += 2000;
      }
      return rows;
    };
    // Leader names, member counts, sessions and attendance depend only on the groups.
    const [bvslUsers, { records: allMembers }, { records: sessions }, allAttendance] = await Promise.all([
      bvslIds.size > 0
        ? Users.findAll({
          filters: { id: { in: Array.from(bvslIds) } } as any,
          fields: ['id', 'fullName'],
          limit: 200,
        }).then(result => result.records)
        : Promise.resolve([] as any[]),
      BvGroupMembers.findAll({
        filters: { group: { in: groupIds } } as any,
        fields: ['id', 'group'],
        limit: 2000,
      }),
      // Sessions in date range (for topic/notes enrichment)
      BvSessions.findAll({
        filters: {
          group: { in: groupIds },
          sessionDate: { gte: startDate, lte: endDate },
        } as any,
        fields: ['id', 'group', 'sessionDate', 'topic', 'notes'],
        limit: 2000,
      }),
      loadAttendance(),
    ]);
    for (const u of bvslUsers) bvslNameMap.set(u.id, u.fullName || '');

    const memberCountByGroup = new Map<string, number>();
    for (const m of allMembers) {
      const gid = Array.isArray(m.group) ? m.group[0] : m.group;
      if (gid) memberCountByGroup.set(gid as string, (memberCountByGroup.get(gid as string) || 0) + 1);
    }

    // Build session lookup: groupId + date → {topic, notes}
    type SessionMeta = { topic: string; notes: string };
    const sessionMetaMap = new Map<string, SessionMeta>();
    for (const s of sessions) {
      const gid = Array.isArray(s.group) ? s.group[0] : s.group as string;
      const date = String(s.sessionDate || '').slice(0, 10);
      if (gid && date) sessionMetaMap.set(`${gid}::${date}`, { topic: s.topic || '', notes: s.notes || '' });
    }

    // Group attendance by groupId + date
    type AttBucket = { presentCount: number; total: number };
    const attByGroupDate = new Map<string, AttBucket>();
    for (const a of allAttendance) {
      const gid = Array.isArray(a.group) ? a.group[0] : a.group as string;
      const date = String(a.attendanceDate || '').slice(0, 10);
      if (!gid || !date) continue;
      const key = `${gid}::${date}`;
      if (!attByGroupDate.has(key)) attByGroupDate.set(key, { presentCount: 0, total: 0 });
      const bucket = attByGroupDate.get(key)!;
      bucket.total++;
      if (a.present) bucket.presentCount++;
    }

    // Build session rows from attendance buckets (one row per group+date)
    const sessionRows: any[] = [];
    for (const [key, bucket] of attByGroupDate.entries()) {
      const [gid, date] = key.split('::');
      const group = groupMap.get(gid);
      if (!group) continue;
      const leaderIds = textList(group.bvslLeader);
      const totalMembers = memberCountByGroup.get(gid) || bucket.total;
      const meta = sessionMetaMap.get(key) || { topic: '', notes: '' };
      const attendancePercent = totalMembers > 0 ? Math.round((bucket.presentCount / totalMembers) * 100) : 0;
      sessionRows.push({
        sessionId: key,
        sessionDate: date,
        groupName: group.groupName || '—',
        groupId: gid,
        bvslName: joinFacilitatorNames(leaderIds.map(id => bvslNameMap.get(id))) || '—',
        topic: meta.topic,
        notes: meta.notes,
        presentCount: bucket.presentCount,
        totalMembers,
        attendancePercent,
      });
    }

    sessionRows.sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));

    return {
      sessions: sessionRows,
      groups: groups.map(g => ({ id: g.id, name: g.groupName || '' })),
    };
  },
});
