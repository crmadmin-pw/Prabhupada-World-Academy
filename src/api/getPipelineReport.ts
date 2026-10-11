import { z } from 'zod';
import { createEndpoint, Users, Guides } from '@/lib/backend-sdk';
import { loadPipelineIndexes } from '../lib/reportPeriodSummary';
import { requireGuideRole } from '../lib/userUtils';

const USER_FIELDS = [
  'id', 'userId', 'fullName', 'phone', 'isB', 'ashrayLevel',
  'guide', 'status', 'role',
];

const ASHRAY_ORDER = [
  'Harinam Diksha', 'Caranashraya', 'Upasaka',
  'Sadhaka', 'Sevak', 'Shraddhavan', 'Jigyasa',
];

export default createEndpoint({
  description: 'Pipeline report: last-6-month monthly metrics per user under guide scope',
  authenticated: true,
  inputSchema: z.object({ guideId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
    });

    const isSuperGuide = context.user.role === 'Super Guide';

    // Compute last 6 months as "YYYY-MM" strings, latest first
    const now = new Date();
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    months.reverse(); // latest month first

    // Resolve guide DB ID (guide-assignment-only scoping, no residency lookups)
    let guideDbId: string | null = null;

    if (!isSuperGuide) {
      const g = await Guides.findOne({
        filters: { email: context.user.email, isActive: true },
        fields: ['id'],
      });
      if (!g) throw new Error('Guide record not found');
      guideDbId = g.id;
    } else if (input.guideId) {
      guideDbId = input.guideId;
    }

    // Fetch active users — guide-assigned only (no residency-based inclusion)
    let users: any[] = [];
    if (guideDbId) {
      const { records } = await Users.findAll({
        filters: { guide: guideDbId, status: 'Active' },
        fields: USER_FIELDS,
        limit: 2000,
      });
      users = records;
    } else {
      const { records } = await Users.findAll({
        filters: { status: 'Active' },
        fields: USER_FIELDS,
        limit: 2000,
      });
      users = records;
    }

    users = users.filter(u => u.userId && (u.fullName || '').trim() && u.role !== 'Guide');
    if (users.length === 0) return { months, sections: [] };

    const [{ sadhanaIdx, meetingsIdx, bvslMeetingsIdx }, { records: allGuides }] = await Promise.all([
      loadPipelineIndexes(months),
      Guides.findAll({ filters: { isActive: true }, fields: ['id', 'fullName'], limit: 200 }),
    ]);

    const guideNameMap = new Map(allGuides.map(g => [g.id, (g as any).fullName || '']));

    function avg(sum: number, count: number): number | null {
      if (!count) return null;
      return Math.round(sum / count * 10) / 10;
    }

    // Build member rows with monthly data
    const memberData = users.map(u => {
      const gid = (Array.isArray(u.guide) ? u.guide[0] : u.guide) as string;
      const monthlyData: Record<string, {
        chanting: number | null; reading: number | null; hearing: number | null;
        oneOnOnes: number | null; booksDistributed: number | null;
        preachingHrs: number | null; meetings: number | null;
      }> = {};
      for (const month of months) {
        const sb = sadhanaIdx.get(u.id)?.get(month);
        const bvslMtg = bvslMeetingsIdx.get(u.id)?.get(month) ?? null;
        monthlyData[month] = {
          chanting: sb ? avg(sb.chantingSum, sb.chantingCount) : null,
          reading: sb ? avg(sb.readingSum, sb.readingCount) : null,
          hearing: sb ? avg(sb.hearingSum, sb.hearingCount) : null,
          oneOnOnes: meetingsIdx.get(u.id)?.get(month) ?? null,
          booksDistributed: sb?.books ? sb.books : null,
          preachingHrs: sb?.preachMins ? Math.round(sb.preachMins / 60 * 10) / 10 : null,
          meetings: bvslMtg && bvslMtg > 0 ? bvslMtg : null,
        };
      }
      return {
        id: u.id,
        fullName: u.fullName || '',
        phone: u.phone || '',
        isB: !!(u as any).isB,
        ashrayLevel: u.ashrayLevel || null,
        guideName: guideNameMap.get(gid) || '',
        monthlyData,
      };
    });

    // Group by ashray level in defined order
    const sectionMap = new Map<string, typeof memberData>();
    for (const m of memberData) {
      const level = m.ashrayLevel || '';
      if (!sectionMap.has(level)) sectionMap.set(level, []);
      sectionMap.get(level)!.push(m);
    }
    const sections: Array<{ level: string; levelNumber: number; members: typeof memberData }> = [];
    ASHRAY_ORDER.forEach((level, i) => {
      const members = sectionMap.get(level);
      if (members?.length) sections.push({ level, levelNumber: i + 1, members });
    });
    for (const [level, members] of sectionMap.entries()) {
      if (!ASHRAY_ORDER.includes(level) && members.length)
        sections.push({ level: level || 'No Level', levelNumber: 99, members });
    }

    return { months, sections };
  },
});
