import { z } from 'zod';
import { createEndpoint, SadhanaEntries, AppError } from '@/lib/backend-sdk';
import { getNRMaxScore, fillingSameDayApplies, normalizeAshrayLevel } from '../lib/userUtils';
import { getScopedHierarchyUserIds } from '@/lib/hierarchyUtils';
import { refreshUserPeriodSummaries } from '../lib/sadhanaPeriodSummary';

function getIstDateStr(isoString: string): string {
  const ms = new Date(isoString).getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(ms).toISOString().split('T')[0];
}

function refValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refValues);
  return value == null ? [] : String(value).split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

export default createEndpoint({
  description: 'Recalculate Sadhana scores for the caller-visible entries in a date range',
  authenticated: true,
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string().optional(),
    userIds: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    fixed: z.number(),
    skipped: z.number(),
    details: z.array(z.object({
      entryDate: z.string(),
      name: z.string().optional(),
      old: z.object({ total: z.number(), rsp: z.number() }),
      new: z.object({ total: z.number(), rsp: z.number(), pct: z.number() }),
    })),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) {
      throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const callerRole = String(context.user.role || '').toUpperCase().replace(/[\s-]+/g, '_');
    const canRecalculate = !!(
      callerRole === 'SUPER_GUIDE' ||
      callerRole === 'GUIDE' ||
      callerRole === 'SUPER_ADMIN' ||
      callerRole === 'ADMIN' ||
      callerRole === 'PW_ADMIN' ||
      context.user.isBvSuperAdmin ||
      context.user.isBvAdmin ||
      context.user.isBvSupervisor ||
      context.user.isBvMentor ||
      context.user.isSadhanaMentor ||
      context.user.isBvFacilitator ||
      context.user.isBvsl ||
      context.user.isBvSubFacilitator
    );
    if (!canRecalculate) {
      throw new AppError({ code: 'FORBIDDEN', message: 'Sadhana report access required' });
    }

    const endDate = input.endDate || input.startDate;
    const requestedUserIds = new Set(
      (input.userIds || [])
        .map(id => String(id || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const hierarchyScope = await getScopedHierarchyUserIds(context.user);
    const callerKeys = [
      context.user.id,
      context.user.userId,
      context.user.email,
    ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
    const allowedUserIds = hierarchyScope === null
      ? requestedUserIds
      : new Set([...requestedUserIds].filter(id => hierarchyScope.has(id) || callerKeys.includes(id)));

    // Paginate until all entries in the date range are fetched
    let allEntries: any[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: { gte: input.startDate, lte: endDate } } as any,
        fields: [
          'id', 'user', 'entryDate', 'submittedAt', 'templateMode', 'flagSick', 'flagOs',
          'totalScore', 'maxScore', 'scorePercent', 'reportSendingPoints',
          'roundsPoints', 'spReadingPoints',
          'maNaGvPoints', 'quotesTulasiPoints', 'japaVisiblePoints', 'sbPoints',
          'cleanlinessPoints', 'dailyServicePoints', 'sleepQualityPoints',
          'ashrayLevelUsed',
          'fieldValuesJson',
        ],
        limit: 2000,
        offset,
      });
      allEntries = allEntries.concat(records);
      if (!hasMore) break;
      offset += 2000;
    }

    let fixed = 0;
    let skipped = 0;
    const details: any[] = [];
    const touched: Array<{ userId: string; entryDate: string }> = [];
    const seen = new Set<string>();

    for (const e of allEntries) {
      const entryUserIds = refValues(e.user);
      const inRequestedScope = requestedUserIds.size === 0 || entryUserIds.some(id => allowedUserIds.has(id));
      const inHierarchyScope = hierarchyScope === null || entryUserIds.some(id => hierarchyScope.has(id) || callerKeys.includes(id));
      if (!inRequestedScope || !inHierarchyScope) {
        skipped++;
        continue;
      }

      const templateMode = String(e.templateMode || '');
      const isResident = templateMode.toUpperCase().includes('RESIDENT') &&
        !templateMode.toUpperCase().includes('NON_RESIDENT');
      const isSickOrOs = !!(e.flagSick || e.flagOs);
      const entryDate = String(e.entryDate || '').split('T')[0];
      const submittedAt = e.submittedAt ? String(e.submittedAt) : null;

      let correctRsp = 0;
      let correctTotal = 0;
      let correctMax = 0;

      if (isResident) {
        // Compute report_sending from submittedAt IST
        if (submittedAt && entryDate) {
          const submittedDateIST = getIstDateStr(submittedAt);
          correctRsp = submittedDateIST === entryDate ? 1 : 0;
        }

        if (isSickOrOs) {
          correctTotal = Number(e.roundsPoints ?? 0) + Number(e.spReadingPoints ?? 0) + correctRsp;
          correctMax = 8;
        } else {
          const basePts = Number(e.maNaGvPoints ?? 0) + Number(e.quotesTulasiPoints ?? 0) +
            Number(e.japaVisiblePoints ?? 0) + Number(e.sbPoints ?? 0) +
            Number(e.cleanlinessPoints ?? 0) + Number(e.dailyServicePoints ?? 0) +
            Number(e.roundsPoints ?? 0) + Number(e.spReadingPoints ?? 0) +
            Number(e.sleepQualityPoints ?? 0);
          correctTotal = basePts + correctRsp;
          correctMax = 20;
        }
      } else {
        // NR: read field pts from fieldValuesJson, recompute fillingSameDay from submittedAt
        let fv: any = {};
        try { fv = JSON.parse(e.fieldValuesJson || '{}'); } catch {}
        const perField: Record<string, number> = (fv._per_field && typeof fv._per_field === 'object')
          ? fv._per_field : {};

        const chantingPts  = Number(fv._pts_chanting      ?? perField.chanting      ?? fv._nr_pts_chanting ?? 0);
        const readingPts   = Number(fv._pts_reading        ?? perField.reading       ?? fv._nr_pts_reading  ?? 0);
        const hearingPts   = Number(fv._pts_hearing        ?? perField.hearing       ?? fv._nr_pts_hearing  ?? 0);
        const wakeUptimePts = Number(fv._pts_wakeUptime    ?? perField.wakeUptime    ?? 0);
        const sleepTimePts  = Number(fv._pts_sleepTime     ?? perField.sleepTime     ?? 0);
        const sevaPts       = Number(fv._pts_seva          ?? perField.seva          ?? 0);
        const bhaktiPts     = Number(fv._pts_bhaktiVriksha ?? perField.bhaktiVriksha ?? 0);

        // Recompute fillingSameDay from submittedAt (server-authoritative day-delay rule)
        const ashrayLevelRaw = e.ashrayLevelUsed || '';
        const ashrayLevel = normalizeAshrayLevel(ashrayLevelRaw);
        if (fillingSameDayApplies(ashrayLevel) && submittedAt && entryDate) {
          const subD = new Date(submittedAt);
          subD.setHours(0, 0, 0, 0);
          const entryD = new Date(entryDate + 'T00:00:00');
          const dayDelay = Math.max(0, Math.round((subD.getTime() - entryD.getTime()) / 86400000));
          correctRsp = Math.max(0, 4 - dayDelay * 2);
        } else {
          correctRsp = 0;
        }

        correctTotal = chantingPts + readingPts + hearingPts + correctRsp
          + wakeUptimePts + sleepTimePts + sevaPts + bhaktiPts;

        // Dynamic max based on ashray level — use stored maxScore as authoritative when available
        const storedMax = Number(e.maxScore ?? 0);
        correctMax = storedMax > 0 ? storedMax : getNRMaxScore(ashrayLevel);
      }

      const correctPct = correctMax > 0
        ? Math.max(0, Math.min(100, Math.round((correctTotal / correctMax) * 100)))
        : 0;

      const dbRsp   = Number(e.reportSendingPoints ?? 0);
      const dbTotal = Number(e.totalScore ?? 0);
      const dbMax   = Number(e.maxScore ?? 0);
      const dbPct   = Number(e.scorePercent ?? 0);

      if (dbRsp === correctRsp && dbTotal === correctTotal && dbMax === correctMax && dbPct === correctPct) {
        skipped++;
        continue;
      }

      await SadhanaEntries.update({
        id: e.id,
        record: {
          reportSendingPoints: correctRsp,
          totalScore: correctTotal,
          maxScore: correctMax,
          scorePercent: correctPct,
        },
      });

      fixed++;
      const owner = String(Array.isArray(e.user) ? e.user[0] : e.user || '').trim();
      const touchKey = `${owner}\0${entryDate}`;
      if (owner && entryDate && !seen.has(touchKey)) {
        seen.add(touchKey);
        touched.push({ userId: owner, entryDate });
      }
      if (details.length < 50) {
        details.push({
          entryDate,
          old: { total: dbTotal, rsp: dbRsp },
          new: { total: correctTotal, rsp: correctRsp, pct: correctPct },
        });
      }
    }

    for (const item of touched) await refreshUserPeriodSummaries(item);

    return { fixed, skipped, details };
  },
});
