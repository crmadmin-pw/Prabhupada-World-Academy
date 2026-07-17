import { z } from 'zod';
import {
  createEndpoint, Users, Guides,
  SadhanaEntries, OneToOneMeetings, BvslPreachingEntries,
} from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

const USER_FIELDS = [
  'id', 'userId', 'fullName', 'phone', 'isB', 'ashrayLevel',
  'guide', 'status', 'role',
];

const ASHRAY_ORDER = [
  'Harinam Diksha', 'Caranashraya', 'Upasaka',
  'Sadhaka', 'Sevak', 'Shraddhavan', 'Jigyasa',
];

async function fetchAllPages<T>(
  fn: (offset: number) => Promise<{ records: T[]; hasMore: boolean }>,
  maxRecords = 10000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (all.length < maxRecords) {
    const { records, hasMore } = await fn(offset);
    all.push(...records);
    if (!hasMore || records.length === 0) break;
    offset += 2000;
  }
  return all;
}

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

    // Date range for fetching entries (oldest month start → latest month end)
    const oldestMonth = months[months.length - 1];
    const latestMonth = months[0];
    const startDate = `${oldestMonth}-01`;
    const [ly, lm] = latestMonth.split('-').map(Number);
    const endDate = `${latestMonth}-${String(new Date(ly, lm, 0).getDate()).padStart(2, '0')}`;

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

    const userIds = new Set(users.map(u => u.id));

    // Batch-fetch all metrics in parallel
    const [sadhanaEntries, meetings, preachingEntries, { records: allGuides }] =
      await Promise.all([
        fetchAllPages(offset =>
          SadhanaEntries.findAll({
            filters: { entryDate: { gte: startDate, lte: endDate } } as any,
            fields: [
              'id', 'user', 'entryDate', 'templateMode',
              'roundsCount', 'nrChantingRounds',
              'spReadingMinutes', 'nrReadingMinutes',
              'studyMinutes', 'nrHearingMinutes',
              'booksDistributed', 'preachingMinutes',
            ],
            limit: 2000, offset,
          })),
        OneToOneMeetings.findAll({
          filters: { meetingDate: { gte: startDate, lte: endDate } } as any,
          fields: ['id', 'member', 'meetingDate'],
          limit: 2000,
        }).then(r => r.records),
        BvslPreachingEntries.findAll({
          filters: { entryDate: { gte: startDate, lte: endDate } } as any,
          fields: ['id', 'user', 'entryDate', 'prUniqueOneOnOnes'],
          limit: 2000,
        }).then(r => r.records),
        Guides.findAll({ filters: { isActive: true }, fields: ['id', 'fullName'], limit: 200 }),
      ]);

    const guideNameMap = new Map(allGuides.map(g => [g.id, (g as any).fullName || '']));

    // Index sadhana entries: userId → month → { chanting[], reading[], hearing[], books, preachMins }
    type SBucket = { chanting: number[]; reading: number[]; hearing: number[]; books: number; preachMins: number };
    const sadhanaIdx = new Map<string, Map<string, SBucket>>();
    for (const e of sadhanaEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid || !userIds.has(uid) || !e.entryDate) continue;
      const month = (e.entryDate as string).substring(0, 7);
      if (!sadhanaIdx.has(uid)) sadhanaIdx.set(uid, new Map());
      if (!sadhanaIdx.get(uid)!.has(month))
        sadhanaIdx.get(uid)!.set(month, { chanting: [], reading: [], hearing: [], books: 0, preachMins: 0 });
      const b = sadhanaIdx.get(uid)!.get(month)!;

      const mode = String(e.templateMode || '').toUpperCase();
      const isRes = mode.includes('RESIDENT') && !mode.includes('NON_RESIDENT');

      if (isRes) {
        if (e.roundsCount != null) b.chanting.push(e.roundsCount as number);
        if (e.spReadingMinutes != null) b.reading.push(e.spReadingMinutes as number);
        if (e.studyMinutes != null) b.hearing.push(e.studyMinutes as number);
      } else {
        if (e.nrChantingRounds != null) b.chanting.push(e.nrChantingRounds as number);
        if (e.nrReadingMinutes != null) b.reading.push(e.nrReadingMinutes as number);
        if (e.nrHearingMinutes != null) b.hearing.push(e.nrHearingMinutes as number);
      }
      b.books += (e.booksDistributed as number) ?? 0;
      b.preachMins += (e.preachingMinutes as number) ?? 0;
    }

    // Index one-to-one meetings: userId → month → count
    const meetingsIdx = new Map<string, Map<string, number>>();
    for (const m of meetings) {
      const uid = (Array.isArray(m.member) ? m.member[0] : m.member) as string;
      if (!uid || !userIds.has(uid) || !m.meetingDate) continue;
      const month = (m.meetingDate as string).substring(0, 7);
      if (!meetingsIdx.has(uid)) meetingsIdx.set(uid, new Map());
      meetingsIdx.get(uid)!.set(month, (meetingsIdx.get(uid)!.get(month) ?? 0) + 1);
    }

    // Index BVSL preaching entries: userId → month → meetings count only
    const bvslMeetingsIdx = new Map<string, Map<string, number>>();
    for (const p of preachingEntries) {
      const uid = (Array.isArray(p.user) ? p.user[0] : p.user) as string;
      if (!uid || !userIds.has(uid) || !p.entryDate) continue;
      const month = (p.entryDate as string).substring(0, 7);
      if (!bvslMeetingsIdx.has(uid)) bvslMeetingsIdx.set(uid, new Map());
      const prev = bvslMeetingsIdx.get(uid)!.get(month) ?? 0;
      bvslMeetingsIdx.get(uid)!.set(month, prev + ((p.prUniqueOneOnOnes as number) ?? 0));
    }

    function avg(arr: number[]): number | null {
      if (!arr.length) return null;
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
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
          chanting: avg(sb?.chanting ?? []),
          reading: avg(sb?.reading ?? []),
          hearing: avg(sb?.hearing ?? []),
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
