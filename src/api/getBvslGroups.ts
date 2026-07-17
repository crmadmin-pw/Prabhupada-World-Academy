import { z } from 'zod';
import { createEndpoint, BvGroups, BvGroupMembers, BvAttendance, BvGroupRequests, Guides, Users } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';

const groupSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  groupName: z.string(),
  description: z.string(),
  memberCount: z.number(),
  totalSessions: z.number(),
  presentToday: z.number(),
  joinToken: z.string().nullable(),
  bvslName: z.string().nullable(),
  guideName: z.string().nullable(),
});

export default createEndpoint({
  description: 'Get BV groups led by a BVSL (with member count, session count, today attendance)',
  authenticated: true,
  inputSchema: z.object({
    bvslId: z.string(), // custom userId field value
  }),
  outputSchema: z.object({
    groups: z.array(groupSchema),
    pendingRequestCount: z.number(),
    error: z.string().nullable(),
  }),
  execute: async ({ input }) => {
    if (!input.bvslId) return { groups: [], pendingRequestCount: 0, error: null };

    const userRecord = await Users.findOne({ filters: { userId: input.bvslId }, fields: ['id', 'fullName', 'guide'] });
    if (!userRecord) return { groups: [], pendingRequestCount: 0, error: null };

    const dbUserId = userRecord.id;

    const { records: groupRecords } = await BvGroups.findAll({
      filters: { bvslLeader: dbUserId, isActive: true },
      limit: 100,
    });

    if (groupRecords.length === 0) return { groups: [], pendingRequestCount: 0, error: null };

    const todayDate = getTodayIST();

    const groups = await Promise.all(groupRecords.map(async (g) => {
      const [membersRes, guideRes] = await Promise.all([
        BvGroupMembers.findAll({ filters: { group: g.id }, limit: 500, fields: ['id'] }),
        g.guide
          ? Guides.findOne({ id: Array.isArray(g.guide) ? g.guide[0] : g.guide as string, fields: ['id', 'fullName'] })
          : Promise.resolve(undefined),
      ]);

      // Count distinct session dates from attendance (total sessions)
      const { records: allGroupAtt } = await BvAttendance.findAll({
        filters: { group: g.id },
        fields: ['attendanceDate'],
        limit: 2000,
      });
      const distinctDates = new Set(allGroupAtt.map((a: any) => a.attendanceDate).filter(Boolean));
      const totalSessions = distinctDates.size;

      // Count present attendance for today directly by group+date
      const { records: todayPresentAtt } = await BvAttendance.findAll({
        filters: { group: g.id, attendanceDate: todayDate, present: true },
        fields: ['id'],
        limit: 200,
      });
      const presentToday = todayPresentAtt.length;

      return {
        id: g.id,
        groupId: g.groupId || g.id,
        groupName: g.groupName || '',
        description: g.description || '',
        memberCount: membersRes.records.length,
        totalSessions,
        presentToday,
        joinToken: g.joinToken || null,
        bvslName: userRecord.fullName || null,
        guideName: (guideRes as any)?.fullName || null,
      };
    }));

    // Count pending join requests
    let pendingRequestCount = 0;
    for (const g of groupRecords) {
      const { records: reqs } = await BvGroupRequests.findAll({
        filters: { group: g.id, status: 'Pending' },
        limit: 100,
        fields: ['id'],
      });
      pendingRequestCount += reqs.length;
    }

    return { groups, pendingRequestCount, error: null };
  },
});
