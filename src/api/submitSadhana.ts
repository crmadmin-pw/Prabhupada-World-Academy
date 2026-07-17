import { z } from 'zod';
import { createEndpoint, SadhanaEntries, BvslPreachingEntries, Users } from 'zite-integrations-backend-sdk';
import { nextSadhanaEntryId, nextBvEntryId } from '../lib/entryIdCounter';
import { getNRMaxScore, fillingSameDayApplies } from '../lib/userUtils';
import { TEMPLATE_MODES } from '../types/enums';
import { computeStreak, daysAgo } from '../lib/streakUtils';


/** Normalize templateMode to canonical TEMPLATE_MODES values */
function normalizeTemplateMode(raw: string | undefined): string {
  if (!raw) return TEMPLATE_MODES.NON_RESIDENT;
  const upper = raw.toUpperCase();
  if (upper.includes('RESIDENT') && !upper.includes('NON_RESIDENT')) return TEMPLATE_MODES.RESIDENT;
  return TEMPLATE_MODES.NON_RESIDENT;
}

const ENTRY_FIND_FIELDS = ['id', 'entryId'];

function normalizeTime(v: any): string {
  if (v == null || v === '' || v === 0 || v === '0') return '';
  const s = String(v).trim();
  if (!s || s === '00:00') return ''; // treat midnight as "not entered"
  // Handle well-formed HH:MM — ensure both parts are zero-padded (fixes "00:0", "9:5", etc.)
  const colonMatch = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    const h = Math.min(23, parseInt(colonMatch[1]));
    const m = Math.min(59, parseInt(colonMatch[2]));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 3) {
    const h = Math.min(23, parseInt(digits.slice(0, digits.length - 2) || '0'));
    const m = Math.min(59, parseInt(digits.slice(-2)));
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return s;
}

function buildEntryRecord(input: any, context: any, entryId: string, now: string): any {
  const fv = input.fieldValues;
  const flagSick = input.flagSick ?? (Array.isArray(fv.flags) ? fv.flags.includes('Sick') : Boolean(fv.flag_sick));
  const flagOs = input.flagOs ?? (Array.isArray(fv.flags) ? fv.flags.includes('OS') : Boolean(fv.flag_os));

  const isResidentEntry = (input.templateMode || '').toUpperCase().includes('RESIDENT') &&
    !(input.templateMode || '').toUpperCase().includes('NON_RESIDENT');

  const entryDateStr = input.entryDate.split('T')[0];

  // ── Report sending: compare entryDate with the IST date of this submission timestamp ──
  // For new submissions, `now` = current time (correct). For recalculations, `now` = stored submittedAt.
  const nowIST = new Date(new Date(now).getTime() + 5.5 * 60 * 60 * 1000);
  const submittedDateIST = nowIST.toISOString().split('T')[0];
  const serverReportSendingPts = isResidentEntry
    ? (entryDateStr === submittedDateIST ? 1 : 0)
    : 0;

  // NR: fillingSameDay uses day-delay rule (compare submittedAt date vs entryDate, UTC midnight)
  const subDNR = new Date(now);
  subDNR.setHours(0, 0, 0, 0);
  const entryDNR = new Date(entryDateStr + 'T00:00:00');
  const nrDayDelay = Math.max(0, Math.round((subDNR.getTime() - entryDNR.getTime()) / 86400000));
  const nrFillingSameDayServerPts = !isResidentEntry ? Math.max(0, 4 - nrDayDelay * 2) : 0;

  // ── Server-authoritative score computation ──────────────────────────────────
  // Read individual field points from the enriched fieldValues sent by frontend.
  // _per_field is set by enrichFieldValues() and contains { fieldKey: scoredPoints }.
  const perField: Record<string, number> = (fv._per_field && typeof fv._per_field === 'object') ? fv._per_field : {};

  const getRoundsPts   = () => Number(perField.rounds ?? perField.rounds_count ?? fv.rounds_points ?? 0);
  const getSpReadPts   = () => Number(perField.sp_reading ?? perField.sp_reading_minutes ?? fv.sp_reading_points ?? 0);
  const getFieldPts    = (key: string) => Number(perField[key] ?? fv[`_pts_${key}`] ?? 0);

  let correctedTotalScore: number;
  let correctedMaxScore: number;
  let correctedScorePercent: number;

  if (isResidentEntry) {
    if (flagSick || flagOs) {
      // Sick/OS resident: rounds (max 4) + sp_reading (max 3) + report_sending (max 1) = max 8
      const basePts = getRoundsPts() + getSpReadPts();
      correctedTotalScore = basePts + serverReportSendingPts;
      correctedMaxScore   = 8;
    } else {
      // Normal resident: 9 base fields (max 19) + report_sending (max 1) = max 20
      const basePts = getFieldPts('ma_na_gv') + getFieldPts('quotes_tulasi') + getFieldPts('japa_visible') +
        getFieldPts('sb') + getFieldPts('cleanliness') + getFieldPts('daily_service') +
        getFieldPts('sleep_quality') + getRoundsPts() + getSpReadPts();
      correctedTotalScore = basePts + serverReportSendingPts;
      correctedMaxScore   = 20;
    }
    correctedScorePercent = Math.max(0, Math.min(100, Math.round((correctedTotalScore / correctedMaxScore) * 100)));
  } else {
    // NR: server trusts frontend for individual field pts (chanting/reading/hearing/wakeUptime/
    // sleepTime/seva/bhaktiVriksha) and overrides fillingSameDay with day-delay rule.
    // Uses _per_field object (set by enrichFieldValues on frontend) as primary source,
    // with _pts_* keys as fallback for older entries.
    const chantingPts  = Number(fv._pts_chanting      ?? perField.chanting      ?? fv._nr_pts_chanting ?? 0);
    const readingPts   = Number(fv._pts_reading        ?? perField.reading       ?? fv._nr_pts_reading  ?? 0);
    const hearingPts   = Number(fv._pts_hearing        ?? perField.hearing       ?? fv._nr_pts_hearing  ?? 0);
    const wakeUptimePts = Number(fv._pts_wakeUptime    ?? perField.wakeUptime    ?? 0);
    const sleepTimePts  = Number(fv._pts_sleepTime     ?? perField.sleepTime     ?? 0);
    const sevaPts       = Number(fv._pts_seva          ?? perField.seva          ?? 0);
    const bhaktiPts     = Number(fv._pts_bhaktiVriksha ?? perField.bhaktiVriksha ?? 0);

    // fillingSameDay: server-authoritative day-delay rule, but ONLY for eligible levels
    // (Jigyasa and Shraddhavan have '-' for this field — they don't earn fillingSameDay pts)
    const ashrayLevel = context.user.ashrayLevel || 'Jigyasa';
    const nrFillingSameDayFinal = fillingSameDayApplies(ashrayLevel) ? nrFillingSameDayServerPts : 0;

    correctedTotalScore = chantingPts + readingPts + hearingPts + nrFillingSameDayFinal
      + wakeUptimePts + sleepTimePts + sevaPts + bhaktiPts;
    // Use frontend-provided maxScore when available (computed by scoring engine),
    // fall back to dynamic per-level max based on which fields are applicable.
    correctedMaxScore   = input.maxScore ?? getNRMaxScore(ashrayLevel);
    correctedScorePercent = Math.max(0, Math.min(100, Math.round((correctedTotalScore / correctedMaxScore) * 100)));
  }

  return {
    entryId,
    user: context.user.id,
    entryDate: input.entryDate.split('T')[0],
    totalScore: correctedTotalScore,
    maxScore: correctedMaxScore,
    scorePercent: correctedScorePercent,
    // 4.2 FIX: normalize to canonical TEMPLATE_MODES values on every write
    templateMode: normalizeTemplateMode(input.templateMode) as any,
    ashrayLevelUsed: input.ashrayLevelUsed || '',
    fieldValuesJson: JSON.stringify({
      ...fv,
      // Overwrite fillingSameDay pts with server-authoritative value for NR (day-delay rule)
      ...(!isResidentEntry && {
        _pts_fillingSameDay: fillingSameDayApplies(context.user.ashrayLevel) ? nrFillingSameDayServerPts : 0,
        _nr_pts_fillingSameDay: fillingSameDayApplies(context.user.ashrayLevel) ? nrFillingSameDayServerPts : 0,
        ...(fv._per_field ? { _per_field: { ...fv._per_field, fillingSameDay: fillingSameDayApplies(context.user.ashrayLevel) ? nrFillingSameDayServerPts : 0 } } : {}),
      }),
      _meta: {
        maxScore: correctedMaxScore,
        scorePercent: correctedScorePercent,
        templateMode: input.templateMode,
        ashrayLevelUsed: input.ashrayLevelUsed,
      },
    }),
    flagSick,
    flagOs,
    roundsCount: Number(fv.rounds ?? fv.rounds_count ?? 0) || 0,
    roundsPoints: getRoundsPts(),
    // NR dedicated columns — populated for NR entries to avoid JSON parsing in reports
    ...(!isResidentEntry && {
      nrChantingRounds: Number(fv.chanting ?? fv.rounds ?? 0) || 0,
      nrChantingPoints: Number(fv._pts_chanting ?? fv._nr_pts_chanting ?? 0) || 0,
      nrReadingMinutes: Number(fv.reading ?? 0) || 0,
      nrReadingPoints: Number(fv._pts_reading ?? fv._nr_pts_reading ?? 0) || 0,
      nrHearingMinutes: Number(fv.hearing ?? 0) || 0,
      nrHearingPoints: Number(fv._pts_hearing ?? fv._nr_pts_hearing ?? 0) || 0,
      nrWakeUpTime: fv.wake_up_time ? String(fv.wake_up_time) : undefined,
      nrSleepTimeRaw: fv.sleepTime ? String(fv.sleepTime) : undefined,
      nrFillingSameDayPoints: nrFillingSameDayServerPts,
    }),
    sleepMinutes: (() => {
      const raw = fv.sleep_minutes ?? fv.sleepTime ?? fv.sleep_hours;
      if (raw == null) return 0;
      if (typeof raw === 'string') {
        // Handle HH:MM or malformed variants like "00:0", "7:5" — split on colon
        if (raw.includes(':')) {
          const parts = raw.split(':').map(s => parseInt(s) || 0);
          return Math.max(0, (parts[0] || 0) * 60 + (parts[1] || 0));
        }
        return Math.max(0, parseInt(raw) || 0);
      }
      return Math.max(0, Number(raw) || 0);
    })(),
    japaFinishTime: normalizeTime(fv.japa_finish_time),
    sbPoints: getFieldPts('sb') || Number(fv.sb ?? 0) || 0,
    spReadingPoints: getSpReadPts(),
    spReadingMinutes: Number(fv.sp_reading ?? fv.sp_reading_minutes ?? 0) || 0,
    preachingMinutes: Number(fv.preaching_raw ?? fv.preaching_minutes ?? 0) || 0,
    booksDistributed: Number(fv.distribution_raw ?? fv.books_distributed ?? 0) || 0,
    studyMinutes: Number(fv.study_minutes ?? (Number(fv.study_hours ?? 0) * 60)) || 0,
    cleanlinessPoints: getFieldPts('cleanliness') || Number(fv.cleanliness ?? 0) || 0,
    // Server-authoritative: 1 if same-day IST (resident), 0 if backdated.
    // For sick/OS: still stored here (used in score for sick/OS now).
    // For NR: day-delay pts 0/2/4.
    reportSendingPoints: isResidentEntry ? serverReportSendingPts : nrFillingSameDayServerPts,
    dailyServicePoints: getFieldPts('daily_service') || Number(fv.daily_service ?? 0) || 0,
    sleepQualityPoints: getFieldPts('sleep_quality') || Number(fv.sleep_quality ?? 0) || 0,
    maNaGvPoints: getFieldPts('ma_na_gv') || Number(fv.ma_na_gv ?? 0) || 0,
    quotesTulasiPoints: getFieldPts('quotes_tulasi') || Number(fv.quotes_tulasi ?? 0) || 0,
    japaVisiblePoints: getFieldPts('japa_visible') || Number(fv.japa_visible ?? 0) || 0,
    submittedAt: now,
  };
}

export default createEndpoint({
  description: 'Submit or update daily sadhana entry (optimized)',
  authenticated: true,
  inputSchema: z.object({
    userId: z.string(),
    entryDate: z.string(),
    totalScore: z.number().int().min(-1000).max(10000),
    maxScore: z.number().int().min(0).max(10000).optional(),
    scorePercent: z.number().min(0).max(100).optional(),
    templateMode: z.string().optional(),
    ashrayLevelUsed: z.string().optional(),
    fieldValues: z.record(z.string(), z.any()),
    flagSick: z.boolean().optional(),
    flagOs: z.boolean().optional(),
    existingRowId: z.union([z.string(), z.number()]).optional(),
    existingEntryId: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    entryId: z.string(),
    message: z.string(),
    isUpdate: z.boolean(),
  }),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const entryDate = input.entryDate.split('T')[0];
    const now = new Date().toISOString();

    const fv = input.fieldValues;
    if (fv) {
      if (fv.rounds !== undefined) fv.rounds = Math.max(0, Math.min(192, Number(fv.rounds) || 0));
      if (fv.chanting !== undefined) fv.chanting = Math.max(0, Math.min(192, Number(fv.chanting) || 0));
      if (fv.distribution_raw !== undefined) fv.distribution_raw = Math.max(0, Math.min(10000, Number(fv.distribution_raw) || 0));
    }

    // Block inactive users from submitting
    const userRec = await Users.findOne({ id: context.user.id, fields: ['id', 'status'] });
    if (userRec?.status === 'Inactive') {
      throw new Error('Your account has been deactivated. Please contact your guide.');
    }

    // Server-side date validation
    const serverNow = new Date();
    const oneDayAhead = new Date(serverNow.getTime() + 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(serverNow);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const entryDateObj = new Date(entryDate + 'T00:00:00');
    if (entryDateObj > oneDayAhead) throw new Error('Cannot submit for a future date');
    if (entryDateObj < sevenDaysAgo) throw new Error('Cannot submit for dates older than 7 days');

    // Use existingRowId if provided (avoids extra findOne)
    let existingId: string | undefined = input.existingRowId ? String(input.existingRowId) : undefined;
    let existingEntryId: string | undefined = input.existingEntryId;

    if (!existingId) {
      const existing = await SadhanaEntries.findOne({
        filters: { user: context.user.id, entryDate },
        fields: ENTRY_FIND_FIELDS,
      });
      existingId = existing?.id;
      existingEntryId = existingEntryId || existing?.entryId;
    }

    // Generate entry ID — O(1) via in-memory counter (see lib/entryIdCounter.ts)
    const entryId: string = existingEntryId ?? await nextSadhanaEntryId();
    const record = buildEntryRecord({ ...input, entryDate }, context, entryId, now);

    // Run main entry save + optional BVSL preaching in parallel where possible
    const bvData = fv._bvsl_preaching;

    if (existingId) {
      await SadhanaEntries.update({ id: existingId, record });
    } else {
      await SadhanaEntries.create({ record });
    }

    // Write BVSL preaching data if present
    if (bvData && typeof bvData === 'object') {
      const totalPreachingMinutes = ['pr_calling_time', 'pr_one_on_one_time', 'pr_book_dist_time', 'pr_rdua_time', 'pr_plan_time']
        .reduce((sum, k) => sum + (Number(bvData[k]) || 0), 0);

      const existingBv = await BvslPreachingEntries.findOne({
        filters: { user: context.user.id, entryDate },
        fields: ['id'],
      });

      // Generate a clean sequential BV-ENTRY-N id for BVSL preaching entries
      // BV entry ID — O(1) via in-memory counter
      let bvEntryId: string;
      if (existingBv) {
        const existing = await BvslPreachingEntries.findOne({ id: existingBv.id, fields: ['entryId'] });
        bvEntryId = existing?.entryId || await nextBvEntryId();
      } else {
        bvEntryId = await nextBvEntryId();
      }

      const bvRecord: any = {
        entryId: bvEntryId,
        user: context.user.id,
        entryDate,
        prCallingTime: Number(bvData.pr_calling_time) || 0,
        prOneOnOneTime: Number(bvData.pr_one_on_one_time) || 0,
        prBookDistTime: Number(bvData.pr_book_dist_time) || 0,
        prRduaTime: Number(bvData.pr_rdua_time) || 0,
        prPlanTime: Number(bvData.pr_plan_time) || 0,
        prRduaAttendees: Number(bvData.pr_rdua_attendees) || 0,
        prBooksDistributed: Number(bvData.pr_books_distributed) || 0,
        prContactsCollected: Number(bvData.pr_contacts_collected) || 0,
        prUniqueOneOnOnes: Number(bvData.pr_unique_one_on_ones) || 0,
        totalPreachingMinutes,
        submittedAt: now,
      };

      if (existingBv) {
        await BvslPreachingEntries.update({ id: existingBv.id, record: bvRecord });
      } else {
        await BvslPreachingEntries.create({ record: bvRecord });
      }
    }

    // Persist streak to DB — non-blocking (so submission never fails due to streak update).
    // Only triggered for today's entry in IST. Recomputes from actual entry history (SSOT —
    // no incremental drift, no stale stored values affecting the result).
    const entryDateForStreak = (record.entryDate as string).slice(0, 10);
    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (entryDateForStreak === todayIST) {
      const userId = context.user.id;
      const streakWindowStart = daysAgo(todayIST, 100);
      SadhanaEntries.findAll({
        filters: { user: userId, entryDate: { gte: streakWindowStart, lte: todayIST } } as any,
        fields: ['entryDate', 'scorePercent'],
        limit: 110,
      }).then(({ records: recentEntries }) => {
        const newStreak = computeStreak(recentEntries as any[], todayIST);
        return Users.update({ id: userId, record: { currentStreak: newStreak, lastStreakUpdatedAt: now } });
      }).catch(() => {});
    }

    return {
      success: true,
      entryId,
      message: existingId ? 'Sadhana updated successfully' : 'Sadhana submitted successfully',
      isUpdate: !!existingId,
    };
  },
});
