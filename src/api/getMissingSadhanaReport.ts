import { z } from 'zod';
import { createEndpoint, Users, Guides, SadhanaEntries, FolkResidencies } from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

const USER_FIELDS = ['id', 'userId', 'fullName', 'status', 'residency', 'guide', 'isScholar', 'residencyClaimed', 'residencyApproved', 'residentSince'];

export default createEndpoint({
  description: 'Get missing sadhana report — who did not submit for each date in a range, with late detection',
  authenticated: true,
  inputSchema: z.object({
    startDate: z.string(),         // YYYY-MM-DD
    endDate: z.string(),           // YYYY-MM-DD
    guideId: z.string().optional(),
    residencyId: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
    });

    const isSuperGuide = context.user.role === 'Super Guide';

    // 1. Find guide record for scoping (regular guide only)
    let guideRecord: any = null;
    if (!isSuperGuide) {
      guideRecord = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id', 'folkResidencies'],
      });
    }

    // 2. Build user query filters
    const filters: any = { status: 'Active' };
    if (!isSuperGuide && guideRecord) {
      filters.guide = guideRecord.id;
    }
    if (isSuperGuide && input.guideId && input.guideId !== 'ALL') {
      filters.guide = input.guideId;
    }
    if (input.residencyId) {
      filters.residency = input.residencyId;
    }

    // 3. Fetch users — guide-scoped + residency-based users
    const { records: baseUsers } = await Users.findAll({ filters, fields: USER_FIELDS, limit: 2000 });
    let allUsers: any[] = [...baseUsers];

    // Include residency-based users for regular guides (same logic as getGuideUsers)
    if (!isSuperGuide && guideRecord && !input.residencyId) {
      const guideRids: string[] = Array.isArray(guideRecord.folkResidencies)
        ? (guideRecord.folkResidencies as string[])
        : (guideRecord.folkResidencies ? [guideRecord.folkResidencies as string] : []);

      if (guideRids.length > 0) {
        const resFetches = await Promise.all(
          guideRids.map(rid =>
            Users.findAll({ filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })
          )
        );
        const userMap = new Map<string, any>();
        for (const u of allUsers) userMap.set(u.id, u);
        for (const res of resFetches) {
          for (const u of res.records) userMap.set(u.id, u);
        }
        allUsers = Array.from(userMap.values());
      }
    }

    // Only registered users (have userId + fullName), excluding guides
    const users = allUsers.filter(u =>
      u.userId &&
      (u.fullName || '').trim().length > 0 &&
      u.role !== 'Guide'
    );

    if (users.length === 0) {
      return {
        users: [],
        dates: [],
        matrix: {},
        stats: { totalUsers: 0, totalDays: 0, totalMissing: 0, totalLate: 0, completionRate: 100 },
        guides: [],
      };
    }

    // 4. Generate dates array (inclusive)
    const dates: string[] = [];
    const d = new Date(input.startDate + 'T00:00:00Z');
    const endD = new Date(input.endDate + 'T00:00:00Z');
    while (d <= endD) {
      dates.push(d.toISOString().split('T')[0]);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    // 5. Fetch all sadhana entries in range (paginated) — include submittedAt for late detection
    const allEntries: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: { gte: input.startDate, lte: input.endDate } as any },
        fields: ['id', 'user', 'entryDate', 'submittedAt'],
        limit: 2000,
        offset,
      });
      allEntries.push(...records);
      if (!hasMore) break;
      offset += 2000;
    }

    // 6. Build submission lookup map: "userId|date" -> "filled" | "late"
    // Late = submittedAt date is strictly after entryDate
    const submissionMap = new Map<string, 'filled' | 'late'>();
    for (const e of allEntries) {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      if (!uid || !e.entryDate) continue;
      const entryDateStr = String(e.entryDate).split('T')[0];
      const key = `${uid}|${entryDateStr}`;
      let status: 'filled' | 'late' = 'filled';
      if (e.submittedAt) {
        const submittedDateStr = String(e.submittedAt).split('T')[0];
        if (submittedDateStr > entryDateStr) {
          status = 'late';
        }
      }
      // If there's already a "filled" entry for this key, keep it (on-time wins)
      if (!submissionMap.has(key) || submissionMap.get(key) === 'late') {
        submissionMap.set(key, status);
      }
    }

    // 7. Fetch residency names (batch)
    const resIds = [...new Set(
      users.map(u => (Array.isArray(u.residency) ? u.residency[0] : u.residency)).filter(Boolean)
    )] as string[];
    const residencyMap = new Map<string, string>();
    if (resIds.length > 0) {
      const { records: residencies } = await FolkResidencies.findAll({
        fields: ['id', 'residencyName'],
        limit: 200,
      });
      for (const r of residencies) {
        residencyMap.set(r.id, (r as any).residencyName || '');
      }
    }

    // 8. Fetch all guides and build guideMap
    const { records: allGuides } = await Guides.findAll({
      fields: ['id', 'fullName'],
      limit: 500,
    });
    const guideMap = new Map<string, string>();
    for (const g of allGuides) {
      guideMap.set(g.id, g.fullName || '');
    }

    // 9. Sort users alphabetically and build matrix
    users.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

    const matrix: Record<string, Record<string, 'filled' | 'late' | 'missed'>> = {};
    let totalMissing = 0;
    let totalLate = 0;

    for (const u of users) {
      matrix[u.id] = {};
      for (const date of dates) {
        const key = `${u.id}|${date}`;
        const status = submissionMap.get(key);
        if (status === 'filled') {
          matrix[u.id][date] = 'filled';
        } else if (status === 'late') {
          matrix[u.id][date] = 'late';
          totalLate++;
        } else {
          matrix[u.id][date] = 'missed';
          totalMissing++;
        }
      }
    }

    const totalCells = users.length * dates.length;
    const totalFilled = totalCells - totalMissing - totalLate;
    const completionRate = totalCells > 0
      ? Math.round(((totalFilled + totalLate) / totalCells) * 100)
      : 100;

    // 10. Build guide list from users in scope
    const seenGuideIds = new Set<string>();
    const guidesInScope: { id: string; name: string }[] = [];
    for (const u of users) {
      const gid = Array.isArray(u.guide) ? u.guide[0] : u.guide;
      if (gid && !seenGuideIds.has(gid)) {
        seenGuideIds.add(gid);
        guidesInScope.push({ id: gid, name: guideMap.get(gid) || 'Unknown' });
      }
    }
    guidesInScope.sort((a, b) => a.name.localeCompare(b.name));

    return {
      users: users.map(u => {
        const resId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const guideId = Array.isArray(u.guide) ? u.guide[0] : u.guide;

        // Determine residency type
        let residencyType: string;
        if (u.isScholar) {
          residencyType = 'Scholar';
        } else if (u.residencyClaimed && u.residencyApproved && resId) {
          residencyType = 'Resident';
        } else {
          residencyType = 'Non-Resident';
        }

        return {
          id: u.id,
          fullName: u.fullName || '',
          userId: u.userId || '',
          residencyName: resId ? (residencyMap.get(resId) || '') : '',
          guideName: guideId ? (guideMap.get(guideId) || '') : '',
          guideId: guideId || '',
          residencyType,
        };
      }),
      dates,
      matrix,
      stats: { totalUsers: users.length, totalDays: dates.length, totalMissing, totalLate, completionRate },
      guides: guidesInScope,
    };
  },
});
