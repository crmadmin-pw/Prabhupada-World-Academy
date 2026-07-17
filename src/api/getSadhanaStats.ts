import { z } from 'zod';
import { createEndpoint, Users, Guides, FolkResidencies, SadhanaEntries, BvGroups, BvGroupMembers } from 'zite-integrations-backend-sdk';
import { requireGuideRole, isScholar as checkIsScholar } from '../lib/userUtils';

const USER_FIELDS = ['id', 'userId', 'fullName', 'ashrayLevel', 'residency', 'residencyApproved', 'temporaryResidencyEnabled', 'temporaryResidency', 'residencyJoinDate', 'scholarSince', 'residentSince'];
const ENTRY_FIELDS = [
  'id', 'user', 'entryDate', 'totalScore', 'scorePercent', 'templateMode',
  'roundsCount', 'spReadingMinutes', 'preachingMinutes', 'booksDistributed',
  'sleepMinutes', 'sbPoints', 'maNaGvPoints', 'cleanlinessPoints',
  'dailyServicePoints', 'sleepQualityPoints', 'flagSick', 'flagOs', 'fieldValuesJson',
];

function parseFieldValues(json: string | null | undefined): Record<string, any> {
  if (!json) return {};
  try { return JSON.parse(json); } catch { return {}; }
}

interface DayAgg {
  total: number; count: number;
  fieldSums: Record<string, number>;
  fieldCounts: Record<string, number>;
}

export default createEndpoint({
  description: 'Aggregate sadhana stats for a guide/bvsl/mentor over a date range',
  authenticated: true,
  inputSchema: z.object({
    guideId: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    bvslMode: z.boolean().optional(),
    mentorMode: z.boolean().optional(),
    residencyFilter: z.enum(['all', 'resident', 'non_resident', 'scholar']).optional(),
    folkResidencyId: z.string().optional(),
    ashrayLevel: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    // Authorization: only Guide, Super Guide, BVSL, or Sadhana Mentor may access stats
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl, isBvMentor: (context.user as any).isBvMentor });

    const { guideId, startDate, endDate, bvslMode, mentorMode, residencyFilter, folkResidencyId, ashrayLevel } = input;

    let guideDbId: string | null = guideId;
    if (bvslMode || mentorMode) {
      const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'guide'] });
      const gid = Array.isArray(userRec?.guide) ? userRec!.guide[0] : userRec?.guide;
      guideDbId = gid ? (gid as string) : null;
      if (!guideDbId) return { dailyTrend: [], fieldAverages: [], userSummaries: [], totalUsers: 0, error: 'No FOLK Guide assigned.' };
    }

    let guideResidencyIds: string[] = [];
    if (guideDbId) {
      const guide = await Guides.findOne({ id: guideDbId, fields: ['id', 'folkResidencies'] });
      guideResidencyIds = Array.isArray(guide?.folkResidencies)
        ? guide!.folkResidencies as string[]
        : (guide?.folkResidencies ? [guide!.folkResidencies as string] : []);
    }

    let users: any[] = [];
    if (guideDbId) {
      const promises = [
        Users.findAll({ filters: { guide: guideDbId, status: 'Active' }, fields: USER_FIELDS, limit: 2000 }),
        ...guideResidencyIds.map(rid => Users.findAll({ filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })),
      ];
      const [guideRes, ...residencyResults] = await Promise.all(promises);
      const map = new Map<string, any>();
      const seenCustomIds = new Set<string>();
      for (const u of guideRes.records) {
        map.set(u.id, u);
        if (u.userId) seenCustomIds.add(String(u.userId));
      }
      for (const res of residencyResults) {
        for (const u of res.records) {
          const cid = u.userId ? String(u.userId) : null;
          if (!map.has(u.id) && !(cid && seenCustomIds.has(cid))) {
            map.set(u.id, u);
            if (cid) seenCustomIds.add(cid);
          }
        }
      }
      users = Array.from(map.values());
    }

    if (bvslMode) {
      const { records: groups } = await BvGroups.findAll({
        filters: { bvslLeader: context.user.id, isActive: true } as any,
        fields: ['id'], limit: 100,
      });
      if (groups.length > 0) {
        const groupIds = groups.map((g: any) => g.id);
        const { records: memberships } = await BvGroupMembers.findAll({
          filters: { group: { in: groupIds } } as any, fields: ['id', 'user'], limit: 2000,
        });
        const memberIds = new Set(memberships.map((m: any) => Array.isArray(m.user) ? m.user[0] : m.user).filter(Boolean));
        users = users.filter(u => memberIds.has(u.id));
      } else { users = []; }
    }

    // Helper: is a user a scholar (temp resident visiting FOLK)?
    // Uses canonical isScholar() from userUtils — requires BOTH temporaryResidencyEnabled AND a linked residency
    const isScholarUser = (u: any) => checkIsScholar(u);

    // Apply filters
    if (residencyFilter && residencyFilter !== 'all') {
      users = users.filter(u => {
        const rawResId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isRes = !!(u.residencyApproved && rawResId);
        if (residencyFilter === 'scholar') return isScholarUser(u);
        if (residencyFilter === 'resident') return isRes && !isScholarUser(u);
        // non_resident: exclude scholars (they're not official residents but not NR either)
        return !isRes && !isScholarUser(u);
      });
    }
    if (folkResidencyId && folkResidencyId !== 'all') {
      users = users.filter(u => {
        const rawResId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
        const isRes = !!(u.residencyApproved && rawResId);
        if (!isRes) return true;
        return rawResId === folkResidencyId;
      });
    }
    if (ashrayLevel && ashrayLevel !== 'all') {
      users = users.filter(u => u.ashrayLevel === ashrayLevel);
    }

    if (users.length === 0) return { dailyTrend: [], fieldAverages: [], userSummaries: [], totalUsers: 0, availableResidencies: [] };

    // Residency name map
    const residencyNameMap = new Map<string, string>();
    if (guideResidencyIds.length > 0) {
      const { records: residencyRecs } = await FolkResidencies.findAll({ fields: ['id', 'residencyName'] as any, limit: 100 });
      for (const r of residencyRecs) {
        residencyNameMap.set(r.id, ((r as any).residencyName || '').replace(/^FOLK\s+/i, ''));
      }
    }

    const userDbIdSet = new Set(users.map(u => u.id));

    // Paginate until all entries in the date range are fetched (avoids 4000-record silent truncation)
    let allEntries: any[] = [];
    let entryOffset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: { gte: startDate, lte: endDate } } as any,
        fields: ENTRY_FIELDS, limit: 2000, offset: entryOffset,
      });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      entryOffset += 2000;
    }

    const filteredEntries = allEntries.filter(e => {
      const uid = Array.isArray(e.user) ? e.user[0] : e.user;
      return !!(uid && userDbIdSet.has(uid as string));
    });

    // Daily trend with per-field aggregation
    const byDate = new Map<string, DayAgg>();

    for (const e of filteredEntries) {
      const date = (e.entryDate as string || '').slice(0, 10);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { total: 0, count: 0, fieldSums: {}, fieldCounts: {} });
      const agg = byDate.get(date)!;

      const fv = parseFieldValues(e.fieldValuesJson as string);
      const isNREntry = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');

      if (e.scorePercent != null) { agg.total += Number(e.scorePercent); agg.count++; }

      const addField = (key: string, val: number) => {
        agg.fieldSums[key] = (agg.fieldSums[key] || 0) + val;
        agg.fieldCounts[key] = (agg.fieldCounts[key] || 0) + 1;
      };

      // Common
      addField('preachingMinutes', Number(e.preachingMinutes ?? 0));
      addField('booksDistributed', Number(e.booksDistributed ?? 0));

      if (!isNREntry) {
        addField('rounds', Number(e.roundsCount ?? 0));
        addField('spReadingMinutes', Number(e.spReadingMinutes ?? 0));
        addField('sbPoints', Number(e.sbPoints ?? 0));
        addField('maNaGvPoints', Number(e.maNaGvPoints ?? 0));
        addField('quotesTulasi', Number(fv.quotes_tulasi ?? 0));
        addField('bath', Number(fv.bath ?? 0));
        addField('japaVisible', Number(fv.japa_visible ?? 0));
        addField('cleanlinessPoints', Number(e.cleanlinessPoints ?? 0));
        addField('reportSending', Number(fv.report_sending ?? 0));
        addField('dailyServicePoints', Number(e.dailyServicePoints ?? 0));
        addField('sleepQualityPoints', Number(e.sleepQualityPoints ?? 0));
        const sleepMins = Number(e.sleepMinutes ?? 0);
        addField('sleepHours', sleepMins > 0 ? Math.round(sleepMins / 60 * 10) / 10 : 0);
        addField('studyMinutes', Number(fv.study_minutes ?? 0));
      } else {
        addField('rounds', Number(fv.chanting ?? fv.rounds ?? e.roundsCount ?? 0));
        addField('reading', Number(fv.reading ?? 0));
        addField('hearing', Number(fv.hearing ?? 0));
        addField('fillingSameDay', Number(fv.fillingSameDay ?? 0));
        addField('seva', Number(fv.seva ?? 0));
        addField('bhaktiVriksha', Number(fv.bhaktiVriksha ?? 0));
      }
    }

    const ALL_KEYS = [
      'rounds', 'spReadingMinutes', 'preachingMinutes', 'booksDistributed',
      'sbPoints', 'maNaGvPoints', 'quotesTulasi', 'bath', 'japaVisible',
      'cleanlinessPoints', 'reportSending', 'dailyServicePoints', 'sleepQualityPoints',
      'sleepHours', 'studyMinutes', 'reading', 'hearing', 'fillingSameDay', 'seva', 'bhaktiVriksha',
    ];

    const dailyTrend: Record<string, any>[] = [];
    const cur = new Date(startDate + 'T00:00:00');
    const endD = new Date(endDate + 'T00:00:00');
    while (cur <= endD) {
      const ds = cur.toISOString().split('T')[0];
      const d = byDate.get(ds);
      const point: Record<string, any> = {
        date: ds,
        avgScorePercent: d && d.count > 0 ? Math.round(d.total / d.count) : null,
        submittedCount: d?.count ?? 0,
      };
      for (const key of ALL_KEYS) {
        if (d && d.fieldCounts[key]) {
          point[key] = Math.round(d.fieldSums[key] / d.fieldCounts[key] * 10) / 10;
        } else {
          point[key] = null;
        }
      }
      dailyTrend.push(point);
      cur.setDate(cur.getDate() + 1);
    }

    // Field averages (simple totals)
    const totalSubmitted = filteredEntries.length;
    const n = totalSubmitted || 1;
    const sums: Record<string, number> = {};
    for (const key of ALL_KEYS) sums[key] = 0;
    for (const e of filteredEntries) {
      const fv = parseFieldValues(e.fieldValuesJson as string);
      const isNREntry = String(e.templateMode || '').toUpperCase().includes('NON_RESIDENT');
      sums.preachingMinutes += Number(e.preachingMinutes ?? 0);
      sums.booksDistributed += Number(e.booksDistributed ?? 0);
      if (!isNREntry) {
        sums.rounds += Number(e.roundsCount ?? 0);
        sums.spReadingMinutes += Number(e.spReadingMinutes ?? 0);
        sums.sbPoints += Number(e.sbPoints ?? 0);
        sums.maNaGvPoints += Number(e.maNaGvPoints ?? 0);
        sums.cleanlinessPoints += Number(e.cleanlinessPoints ?? 0);
        sums.dailyServicePoints += Number(e.dailyServicePoints ?? 0);
        sums.sleepQualityPoints += Number(e.sleepQualityPoints ?? 0);
        const sm = Number(e.sleepMinutes ?? 0);
        sums.sleepHours += sm > 0 ? Math.round(sm / 60 * 10) / 10 : 0;
        sums.quotesTulasi += Number(fv.quotes_tulasi ?? 0);
        sums.bath += Number(fv.bath ?? 0);
        sums.japaVisible += Number(fv.japa_visible ?? 0);
        sums.reportSending += Number(fv.report_sending ?? 0);
        sums.studyMinutes += Number(fv.study_minutes ?? 0);
      } else {
        sums.rounds += Number(fv.chanting ?? fv.rounds ?? e.roundsCount ?? 0);
        sums.reading += Number(fv.reading ?? 0);
        sums.hearing += Number(fv.hearing ?? 0);
        sums.fillingSameDay += Number(fv.fillingSameDay ?? 0);
        sums.seva += Number(fv.seva ?? 0);
        sums.bhaktiVriksha += Number(fv.bhaktiVriksha ?? 0);
      }
    }
    const av = (s: number) => Math.round(s / n * 10) / 10;
    const fieldAverages = [
      { field: 'rounds', label: 'Rounds', avg: av(sums.rounds), unit: '' },
      { field: 'spReading', label: 'SP Reading', avg: av(sums.spReadingMinutes), unit: 'min' },
      { field: 'preaching', label: 'Preaching', avg: av(sums.preachingMinutes), unit: 'min' },
      { field: 'books', label: 'Books', avg: av(sums.booksDistributed), unit: '' },
    ];

    // Per-user summaries
    const entriesByUser = new Map<string, any[]>();
    for (const e of filteredEntries) {
      const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
      if (!uid) continue;
      if (!entriesByUser.has(uid)) entriesByUser.set(uid, []);
      entriesByUser.get(uid)!.push(e);
    }
    const totalDays = Math.max(1, dailyTrend.length);
    const midDate = dailyTrend[Math.floor(totalDays / 2)]?.date || startDate;

    const userSummaries = users.map(u => {
      const ue = (entriesByUser.get(u.id) || []).sort((a: any, b: any) => (a.entryDate as string).localeCompare(b.entryDate as string));
      const submitted = ue.length;
      const avgScore = submitted > 0 ? Math.round(ue.reduce((s: number, e: any) => s + (e.scorePercent ?? 0), 0) / submitted) : 0;
      const fh = ue.filter((e: any) => (e.entryDate as string) < midDate);
      const sh = ue.filter((e: any) => (e.entryDate as string) >= midDate);
      const fhAvg = fh.length ? fh.reduce((s: number, e: any) => s + (e.scorePercent ?? 0), 0) / fh.length : null;
      const shAvg = sh.length ? sh.reduce((s: number, e: any) => s + (e.scorePercent ?? 0), 0) / sh.length : null;
      let trend: 'up' | 'down' | 'flat' = 'flat';
      if (fhAvg != null && shAvg != null) {
        if (shAvg - fhAvg > 5) trend = 'up';
        else if (fhAvg - shAvg > 5) trend = 'down';
      }
      const rawResidencyId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const isOfficialResident = !!(u.residencyApproved && rawResidencyId);
      const isScholar = isScholarUser(u);
      // Scholars use resident template — treat as resident for scoring/display purposes
      const isResident = isOfficialResident || isScholar;
      const residencyName = isOfficialResident && rawResidencyId ? (residencyNameMap.get(rawResidencyId as string) || null) : (isScholar ? 'Scholar' : null);
      return {
        userId: u.userId || u.id, fullName: u.fullName || '',
        ashrayLevel: u.ashrayLevel || null,
        isResident, residencyName,
        submittedCount: submitted, totalDays, avgScorePercent: avgScore, trend,
      };
    });

    const availableResidencies = guideResidencyIds.map(rid => ({
      residencyId: rid,
      residencyName: residencyNameMap.get(rid) || rid,
    }));

    return {
      dailyTrend, fieldAverages,
      userSummaries: userSummaries.sort((a, b) => b.avgScorePercent - a.avgScorePercent),
      totalUsers: users.length, totalSubmitted,
      availableResidencies,
    };
  },
});
