import { z } from 'zod';
import { getDashboardHierarchyScope, isUserInHierarchy, isHierarchyAdmin, readScopedUsers } from '../lib/hierarchyUtils';
import { createEndpoint, Users, Guides, FolkResidencies, SadhanaEntries } from '@/lib/backend-sdk';
import { getGuideScope } from '../lib/guideScope';
import { requireGuideRole, isScholar as checkIsScholar } from '../lib/userUtils';
import { resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';
import { resolveBvAdminFacilitators } from '../lib/bvAdminFacilitatorScope';
import { pwScoreFromFieldValues } from '@/lib/pwSadhana';

const USER_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'email', 'segment', 'ashrayLevel', 'residency', 'residencyApproved', 'temporaryResidencyEnabled', 'temporaryResidency', 'residencyJoinDate', 'scholarSince', 'residentSince', 'sadhanaMentor', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];
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

const USER_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

function userIdentityAliases(user: any): string[] {
  return [...new Set(USER_IDENTITY_FIELDS
    .map(field => user?.[field])
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase())
    .filter(Boolean))];
}

function isPrabhupadaWorldSegment(segment: unknown): boolean {
  const normalized = String(segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  return normalized === 'PW' || normalized === 'PRABHUPADAWORLD';
}

/** Supports both the legacy NON_RESIDENT_TEMPLATE value and the current
 * canonical NR_TEMPLATE value written by submitSadhana. */
function isNonResidentEntry(templateMode: unknown): boolean {
  const normalized = String(templateMode || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized.includes('NON_RESIDENT') || normalized === 'NR_TEMPLATE' || normalized === 'NR';
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
    facilitatorMode: z.boolean().optional(),
    groupId: z.string().optional(),
    residencyFilter: z.enum(['all', 'resident', 'non_resident', 'scholar']).optional(),
    folkResidencyId: z.string().optional(),
    ashrayLevel: z.string().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    // Authorization: only Guide, Super Guide, BVSL, or Sadhana Mentor may access stats
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: (context.user as any).isBvMentor,
      isBvSupervisor: (context.user as any).isBvSupervisor,
      isBvSubFacilitator: (context.user as any).isBvSubFacilitator,
    });

    const { guideId, startDate, endDate, bvslMode, mentorMode, facilitatorMode, residencyFilter, folkResidencyId, ashrayLevel } = input;

    const normalizedSegment = String(context.user.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const isPwMentor = !!mentorMode && (input.segment === 'PW' || normalizedSegment === 'PW' || normalizedSegment === 'PRABHUPADAWORLD');
    const mentorUser = isPwMentor
      ? (await Users.findOne({ id: context.user.id, fields: ['id', 'userId', 'email'] })
        || await Users.findOne({ filters: { email: context.user.email }, fields: ['id', 'userId', 'email'] }))
      : null;
    const mentorReferences = new Set(
      [context.user.id, (mentorUser as any)?.id, (mentorUser as any)?.userId, context.user.email]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean),
    );

    let guideDbId: string | null = isPwMentor || guideId === 'ALL' ? null : guideId;
    if (isHierarchyAdmin(context.user)) guideDbId = null;
    if ((bvslMode || mentorMode) && !isPwMentor) {
      const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'guide'] });
      const gid = Array.isArray(userRec?.guide) ? userRec!.guide[0] : userRec?.guide;
      guideDbId = gid ? (gid as string) : null;
      if (!guideDbId && mentorMode) return { dailyTrend: [], fieldAverages: [], userSummaries: [], totalUsers: 0, error: 'No FOLK Guide assigned.' };
    }

    let guideResidencyIds: string[] = [];
    let users: any[] = [];
    if (facilitatorMode) {
      users = await resolveBvAdminFacilitators(context.user, guideId, USER_FIELDS, input.segment);
    } else if (isPwMentor) {
      // A PW Sadhana Mentor sees only members explicitly assigned through
      // sadhanaMentor, never every member under the mentor's linked admin.
      const { records } = await readScopedUsers(context.user, { filters: { status: 'Active' }, fields: USER_FIELDS, limit: 2000 });
      users = records.filter((user: any) => {
        const assigned = Array.isArray(user.sadhanaMentor) ? user.sadhanaMentor : [user.sadhanaMentor];
        return isPrabhupadaWorldSegment(user.segment)
          && assigned.some((value: any) => mentorReferences.has(String(value || '').trim().toLowerCase()));
      });
    } else if (guideDbId) {
      const guide = await Guides.findOne({ id: guideDbId, fields: ['id', 'folkResidencies'] });
      if (guide) {
        guideResidencyIds = Array.isArray(guide.folkResidencies)
          ? guide.folkResidencies as string[]
          : (guide.folkResidencies ? [guide.folkResidencies as string] : []);
      } else {
        const scope = await getGuideScope(context.user.email || '');
        guideResidencyIds = scope?.residencyIds || [];
      }
    }

    if (!facilitatorMode && !isPwMentor && guideDbId) {
      const promises = [
        readScopedUsers(context.user, { filters: { guide: guideDbId, status: 'Active' }, fields: USER_FIELDS, limit: 2000 }),
        ...guideResidencyIds.map(rid => readScopedUsers(context.user, { filters: { residency: rid, status: 'Active' }, fields: USER_FIELDS, limit: 500 })),
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
    } else if (!facilitatorMode && !isPwMentor) {
      // ALL mode — fetch all active users, scoped by segment if provided
      const allUsersFilter: any = { status: 'Active' };
      if (input.segment) allUsersFilter.segment = input.segment;
      const { records } = await readScopedUsers(context.user, { filters: allUsersFilter, fields: USER_FIELDS, limit: 2000 });
      users = records;
    }

    if (bvslMode) {
      users = await resolveBvGroupMemberUsers(context.user, USER_FIELDS, {
        groupId: input.groupId,
        segment: input.segment,
        excludeCaller: true,
      });
    }

    const scope = await getDashboardHierarchyScope(context.user, guideId);
    users = users.filter(user => isUserInHierarchy(user, scope));

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

    // Entries are written with the authenticated Firebase identity. Keep a
    // mapping from every historical/custom user identifier back to the member
    // record so RGF statistics remain correct after identity migrations.
    const userAliasToPrimaryId = new Map<string, string>();
    users.forEach(user => {
      userIdentityAliases(user).forEach(alias => userAliasToPrimaryId.set(alias, user.id));
    });

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
      const owner = String(Array.isArray(e.user) ? e.user[0] : e.user || '').trim().toLowerCase();
      return !!owner && userAliasToPrimaryId.has(owner);
    });

    // Daily trend with per-field aggregation
    const byDate = new Map<string, DayAgg>();

    for (const e of filteredEntries) {
      const date = (e.entryDate as string || '').slice(0, 10);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { total: 0, count: 0, fieldSums: {}, fieldCounts: {} });
      const agg = byDate.get(date)!;

      const fv = parseFieldValues(e.fieldValuesJson as string);
      const isNREntry = isNonResidentEntry(e.templateMode);

      const addField = (key: string, val: number) => {
        agg.fieldSums[key] = (agg.fieldSums[key] || 0) + val;
        agg.fieldCounts[key] = (agg.fieldCounts[key] || 0) + 1;
      };

      if (input.segment === 'PW') {
        const scored = pwScoreFromFieldValues(e.fieldValuesJson);
        if (scored.scorePercent != null) { agg.total += scored.scorePercent; agg.count++; }
        addField('rounds', scored.chanting);
        addField('reading', scored.reading);
        continue;
      }

      if (e.scorePercent != null) { agg.total += Number(e.scorePercent); agg.count++; }

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
      const isNREntry = isNonResidentEntry(e.templateMode);
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
      const owner = String(Array.isArray(e.user) ? e.user[0] : e.user || '').trim().toLowerCase();
      const primaryUserId = userAliasToPrimaryId.get(owner);
      if (!primaryUserId) continue;
      if (!entriesByUser.has(primaryUserId)) entriesByUser.set(primaryUserId, []);
      entriesByUser.get(primaryUserId)!.push(e);
    }
    const totalDays = Math.max(1, dailyTrend.length);
    const midDate = dailyTrend[Math.floor(totalDays / 2)]?.date || startDate;

    const userSummaries = users.map(u => {
      const ue = (entriesByUser.get(u.id) || []).sort((a: any, b: any) => (a.entryDate as string).localeCompare(b.entryDate as string));
      const submitted = ue.length;
      const percents = input.segment === 'PW'
        ? ue.map((e: any) => pwScoreFromFieldValues(e.fieldValuesJson).scorePercent).filter((value: number | null): value is number => value != null)
        : ue.map((e: any) => e.scorePercent).filter((value: any) => value != null);
      const avgScore = percents.length > 0 ? Math.round(percents.reduce((s: number, value: number) => s + Number(value), 0) / percents.length) : 0;
      const entryPercent = (entry: any) => input.segment === 'PW'
        ? pwScoreFromFieldValues(entry.fieldValuesJson).scorePercent
        : entry.scorePercent;
      const fh = ue.filter((e: any) => (e.entryDate as string) < midDate).map(entryPercent).filter((value: any) => value != null);
      const sh = ue.filter((e: any) => (e.entryDate as string) >= midDate).map(entryPercent).filter((value: any) => value != null);
      const fhAvg = fh.length ? fh.reduce((s: number, value: number) => s + Number(value), 0) / fh.length : null;
      const shAvg = sh.length ? sh.reduce((s: number, value: number) => s + Number(value), 0) / sh.length : null;
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
      const normalizedRole = String(u.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const facilitatorRole = u.isBvSubFacilitator || ['RGSF', 'SUB_FACILITATOR', 'BV_SUB_FACILITATOR'].includes(normalizedRole)
        ? 'RGSF'
        : u.isBvFacilitator || u.isBvsl || ['RGF', 'BVSL', 'FACILITATOR', 'BV_FACILITATOR'].includes(normalizedRole)
          ? 'RGF'
          : undefined;
      return {
        userId: u.userId || u.id, fullName: u.fullName || u.displayName || u.name || u.userId || u.id,
        facilitatorRole,
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
