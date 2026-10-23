import { z } from 'zod';
import { getScopedHierarchyUserIds, isUserInHierarchy, readScopedUsers } from '../lib/hierarchyUtils';
import { createEndpoint, FolkResidencies } from '@/lib/backend-sdk';
import { folkScoreFromTotals, loadFolkTotals, mergeFolkTotals, type FolkTotals } from '../lib/reportPeriodSummary';
import { requireGuideRole } from '../lib/userUtils';
import { getGuideScope } from '../lib/guideScope';
import { bvUserAliases, resolveBvGroupMemberUsers } from '../lib/bvGroupMemberScope';
import { resolveBvAdminFacilitators } from '../lib/bvAdminFacilitatorScope';
import { getSadhanaMentorResidencyScope } from '../lib/sadhanaMentorResidencyScope';
import { readFolkHostelSadhanaUsers } from '../lib/folkHostelSadhanaScope';

const MEMBER_USER_FIELDS = ['id', 'userId', 'email', 'residency', 'residencyApproved', 'temporaryResidencyEnabled', 'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

const RESIDENT_FIELD_DEFS = [
  { key: 'quotes_tulasi',    shortLabel: 'Quotes/Pranam', maxPoints: 1,    isScoring: true,  forResident: true, forNR: false },
  { key: 'japa_visible',     shortLabel: 'Japa MTH',      maxPoints: 2,    isScoring: true,  forResident: true, forNR: false },
  { key: 'ma_na_gv',         shortLabel: 'DA+NA+GP+Kirtan', maxPoints: 3,    isScoring: true,  forResident: true, forNR: false },
  { key: 'bath',             shortLabel: 'Bath',          maxPoints: 0,    isScoring: true,  forResident: true, forNR: false },
  { key: 'sb',               shortLabel: 'SB Class',      maxPoints: 2,    isScoring: true,  forResident: true, forNR: false },
  { key: 'cleanliness',      shortLabel: 'Clean Area',    maxPoints: 1,    isScoring: true,  forResident: true, forNR: false },
  { key: 'daily_service',    shortLabel: 'Service',       maxPoints: 2,    isScoring: true,  forResident: true, forNR: false },
  { key: 'report_sending',   shortLabel: 'SameDay Fill',  maxPoints: 1,    isScoring: true,  forResident: true, forNR: false },
  { key: 'rounds',           shortLabel: 'Rounds',        maxPoints: 4,    isScoring: true,  forResident: true, forNR: false },
  { key: 'sp_reading',       shortLabel: 'Book Reading',  maxPoints: 3,    isScoring: true,  forResident: true, forNR: false },
  { key: 'sleep_quality',    shortLabel: 'Sleep Quality', maxPoints: 1,    isScoring: true,  forResident: true, forNR: false },
  { key: 'japa_finish_time', shortLabel: 'Japa End',      maxPoints: null, isScoring: false, forResident: true, forNR: false },
  { key: 'sleep_minutes',    shortLabel: 'Sleep',     maxPoints: null, isScoring: false, forResident: true, forNR: false },
  { key: 'study_minutes',    shortLabel: 'Study',     maxPoints: null, isScoring: false, forResident: true, forNR: false },
  { key: 'preaching_raw',    shortLabel: 'Preach',    maxPoints: null, isScoring: false, forResident: true, forNR: false },
  { key: 'distribution_raw', shortLabel: 'Books Dist',    maxPoints: null, isScoring: false, forResident: true, forNR: false },
];

/** Average of all non-null numeric values (includes 0) */
function numAvgAll(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v != null && !isNaN(v));
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10;
}

/** Average excluding 0 and null (for optional fields like sleep/study) */
function numAvgNonZero(vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v): v is number => v != null && !isNaN(v) && v > 0);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length * 10) / 10;
}

export default createEndpoint({
  description: 'Get sadhana averages for ALL FOLK residencies — powers the Guide Leaderboard sub-tab FOLK Report',
  authenticated: true,
  requiredCapabilities: 'sadhana.reports',
  inputSchema: z.object({
    date: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    bvslMode: z.boolean().optional(),
    facilitatorMode: z.boolean().optional(),
    guideId: z.string().optional(),
    groupId: z.string().optional(),
    segment: z.enum(['PW', 'FOLK']).optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: { input: any; context: any }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, {
      isSadhanaMentor: context.user.isSadhanaMentor,
      isBvsl: context.user.isBvsl,
      isBvMentor: context.user.isBvMentor,
      isBvSupervisor: context.user.isBvSupervisor,
      isBvSubFacilitator: (context.user as any).isBvSubFacilitator,
    });

    const effectiveStart = (input.startDate || input.date).split('T')[0];
    const effectiveEnd   = (input.endDate   || input.date).split('T')[0];

    // 1. Fetch ALL active official residents (not scholars/temp)
    const residencyMentorScope = !input.bvslMode && !input.facilitatorMode ? await getSadhanaMentorResidencyScope(context.user) : null;
    const allUsers: any[] = residencyMentorScope ? await readFolkHostelSadhanaUsers(residencyMentorScope, MEMBER_USER_FIELDS) : [];
    let uOffset = 0;
    while (!residencyMentorScope) {
      const { records, hasMore } = await readScopedUsers(context.user, {
        filters: { status: 'Active', residencyApproved: true },
        fields: ['id', 'residency', 'residencyApproved', 'temporaryResidencyEnabled'],
        limit: 2000,
        offset: uOffset,
      });
      allUsers.push(...records);
      if (!hasMore) break;
      uOffset += 2000;
    }

    const userRole = (context.user.role || 'User').toUpperCase().replace(/\s+/g, '_');
    const isSuperGuide = userRole === 'SUPER_GUIDE' ||
      userRole === 'SUPER_ADMIN' ||
      userRole === 'PW_ADMIN' ||
      !!context.user.isBvSuperAdmin ||
      !!context.user.isBvAdmin;

    let guideRecord: any = null;
    let guideRids: string[] = [];
    if (!isSuperGuide && !residencyMentorScope) {
      const scope = await getGuideScope(context.user.email || '');
      guideRecord = scope ? { id: scope.guideId } : null;
      guideRids = scope?.residencyIds || [];
    }

    const scopedUsers = input.bvslMode
      ? await resolveBvGroupMemberUsers(context.user, MEMBER_USER_FIELDS, {
          groupId: input.groupId,
          segment: 'FOLK',
          excludeCaller: true,
        })
      : input.facilitatorMode
        ? await resolveBvAdminFacilitators(context.user, input.guideId, MEMBER_USER_FIELDS, input.segment)
        : allUsers;
    const hierarchy = residencyMentorScope ? null : await getScopedHierarchyUserIds(context.user);
    const residents = scopedUsers.filter(u => {
      if (!isUserInHierarchy(u, hierarchy)) return false;
      const resId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      const isApprovedRes = u.residencyApproved && resId && !u.temporaryResidencyEnabled;
      if (!isApprovedRes) return false;
      if (!residencyMentorScope && !input.bvslMode && !input.facilitatorMode && !isSuperGuide) {
        return guideRids.includes(resId);
      }
      return true;
    });

    const scopedTitle = input.facilitatorMode ? 'Facilitators' : input.bvslMode ? 'Assigned Groups' : isSuperGuide ? 'All Residencies' : 'My Residency';
    if (residents.length === 0) return { folkRows: [], fieldDefs: RESIDENT_FIELD_DEFS, title: scopedTitle };

    const residentAliasToId = new Map<string, string>();
    residents.forEach(user => bvUserAliases(user).forEach(alias => residentAliasToId.set(alias, user.id)));

    const totalsByAlias = await loadFolkTotals(effectiveStart, effectiveEnd);
    const totalsByUser = new Map<string, FolkTotals>();
    for (const [rawUid, totals] of totalsByAlias) {
      const uid = residentAliasToId.get(rawUid);
      if (!uid) continue;
      const existing = totalsByUser.get(uid);
      totalsByUser.set(uid, existing ? mergeFolkTotals(existing, totals) : totals);
    }

    // 4. Group residents by residencyId
    const byResidency = new Map<string, any[]>();
    for (const u of residents) {
      const resId = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      if (!resId) continue;
      if (!byResidency.has(resId)) byResidency.set(resId, []);
      byResidency.get(resId)!.push(u);
    }

    // 5. Fetch residency names
    const residencyIds = [...byResidency.keys()];
    const residencyNameMap: Record<string, string> = {};
    if (residencyIds.length > 0) {
      const recs = await Promise.all(
        residencyIds.map(id => FolkResidencies.findOne({ id, fields: ['id', 'residencyName'] }))
      );
      recs.forEach(r => { if (r?.id) residencyNameMap[r.id] = (r as any).residencyName || ''; });
    }

    // 6. Compute per-FOLK rows
    const folkRows: any[] = [];

    for (const [residencyId, members] of byResidency) {
      type UserScore = {
        flagSick: boolean; flagOs: boolean;
        roundsCount: number | null; spReadingMinutes: number | null;
        roundsPoints: number | null; spReadingPoints: number | null;
        sbPoints: number | null; maNaGvPoints: number | null;
        quotesTulasiPoints: number | null; japaVisiblePoints: number | null;
        cleanlinessPoints: number | null; reportSendingPoints: number | null;
        dailyServicePoints: number | null; sleepQualityPoints: number | null;
        bathPoints: number | null;
        japaTimeMins: number | null; sleepMins: number | null;
        studyMins: number | null; preachingTotal: number | null; booksTotal: number | null;
        scorePercent: number | null;
      };

      const submitted: UserScore[] = [];

      for (const u of members) {
        const totals = totalsByUser.get(u.id);
        if (!totals || totals.entryCount === 0) continue;
        submitted.push(folkScoreFromTotals(totals));
      }

      const nonSickOs = submitted.filter(s => !s.flagSick && !s.flagOs);
      const normPool  = nonSickOs.length > 0 ? nonSickOs : submitted;

      const displayAvgs: Record<string, number | null> = {
        // Use scored points (not raw counts/minutes) so values match the /maxPoints column headers
        rounds:          numAvgAll(submitted.map(s => s.roundsPoints)),
        sp_reading:      numAvgAll(submitted.map(s => s.spReadingPoints)),
        report_sending:  numAvgAll(submitted.map(s => s.reportSendingPoints)),
        sb:              numAvgAll(normPool.map(s => s.sbPoints)),
        ma_na_gv:        numAvgAll(normPool.map(s => s.maNaGvPoints)),
        quotes_tulasi:   numAvgAll(normPool.map(s => s.quotesTulasiPoints)),
        japa_visible:    numAvgAll(normPool.map(s => s.japaVisiblePoints)),
        cleanliness:     numAvgAll(normPool.map(s => s.cleanlinessPoints)),
        daily_service:   numAvgAll(normPool.map(s => s.dailyServicePoints)),
        sleep_quality:   numAvgAll(normPool.map(s => s.sleepQualityPoints)),
        bath:            numAvgAll(normPool.map(s => s.bathPoints)),
        // Informational fields
        japa_finish_time: numAvgNonZero(normPool.map(s => s.japaTimeMins)),
        sleep_minutes:    numAvgNonZero(normPool.map(s => s.sleepMins)),
        study_minutes:    numAvgNonZero(submitted.map(s => s.studyMins)),
        // Totals (sum across all submitted members in the FOLK)
        preaching_raw:    submitted.reduce((acc, s) => acc + (s.preachingTotal ?? 0), 0) || null,
        distribution_raw: submitted.reduce((acc, s) => acc + (s.booksTotal ?? 0), 0) || null,
      };

      const scoredAvgs: Record<string, number | null> = {
        rounds:          numAvgAll(submitted.map(s => s.roundsPoints)),
        sp_reading:      numAvgAll(submitted.map(s => s.spReadingPoints)),
        report_sending:  numAvgAll(submitted.map(s => s.reportSendingPoints)),
        sb:              numAvgAll(normPool.map(s => s.sbPoints)),
        ma_na_gv:        numAvgAll(normPool.map(s => s.maNaGvPoints)),
        quotes_tulasi:   numAvgAll(normPool.map(s => s.quotesTulasiPoints)),
        japa_visible:    numAvgAll(normPool.map(s => s.japaVisiblePoints)),
        cleanliness:     numAvgAll(normPool.map(s => s.cleanlinessPoints)),
        daily_service:   numAvgAll(normPool.map(s => s.dailyServicePoints)),
        sleep_quality:   numAvgAll(normPool.map(s => s.sleepQualityPoints)),
        bath:            numAvgAll(normPool.map(s => s.bathPoints)),
        japa_finish_time: null, sleep_minutes: null, study_minutes: null,
        preaching_raw: null, distribution_raw: null,
      };

      const scoreVals = submitted.map(s => s.scorePercent).filter((v): v is number => v !== null);
      const avgScore = scoreVals.length > 0
        ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length)
        : null;

      // Weighted score = avgScore × (submitted / total) — penalises low participation
      const participationRate = members.length > 0 ? submitted.length / members.length : 0;
      const weightedScore = avgScore != null ? Math.round(avgScore * participationRate * 10) / 10 : null;

      folkRows.push({
        residencyId,
        folkName: (residencyNameMap[residencyId] || '').replace(/^FOLK\s+/i, '') || residencyId,
        total: members.length,
        submitted: submitted.length,
        displayAvgs,
        scoredAvgs,
        avgScore,
        weightedScore,
      });
    }

    folkRows.sort((a, b) => (b.weightedScore ?? -1) - (a.weightedScore ?? -1));

    const residencyNames = residencyIds.map(id => (residencyNameMap[id] || '').replace(/^FOLK\s+/i, '') || id);
    const title = input.bvslMode
      ? 'Assigned Groups'
      : isSuperGuide
      ? "All Residencies"
      : (residencyNames.length > 0 ? residencyNames.join(', ') : 'My Residency');

    return { folkRows, fieldDefs: RESIDENT_FIELD_DEFS, title };
  },
});
