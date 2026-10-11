import { z } from 'zod';
import { createEndpoint, FolkResidencies, PreachingReportGoals } from '@/lib/backend-sdk';
import { loadPreachingDays, loadPreachingRoster } from '../lib/reportPeriodSummary';
import { requireGuideRole } from '../lib/userUtils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtD(s: string) { const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function stripFOLK(n: string) { return (n || '').replace(/^folk\s+/i, '').toUpperCase(); }

function computeWeeks(s: string, e: string) {
  const start = new Date(s + 'T00:00:00'), end = new Date(e + 'T00:00:00');
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - cursor.getDay());
  const weeks: { start: string; end: string; label: string }[] = [];
  while (cursor <= end) {
    const ws = cursor.toISOString().split('T')[0];
    const we = new Date(cursor); we.setDate(we.getDate() + 6);
    const weStr = we.toISOString().split('T')[0];
    if (weStr >= s && ws <= e) weeks.push({ start: ws, end: weStr, label: `${fmtD(ws)} - ${fmtD(weStr)}` });
    cursor.setDate(cursor.getDate() + 7);
  }
  // Most recent week first
  weeks.reverse();
  return weeks;
}

type WMap = Map<string, number | null>;
type Matrix = Map<string, WMap>;
function findWk(d: string, weeks: { start: string; end: string; label: string }[]) { return weeks.find(w => d >= w.start && d <= w.end); }
function addM(m: Matrix, cid: string, wl: string, v: number) { const r = m.get(cid); if (!r) return; r.set(wl, (r.get(wl) ?? 0) + v); }

export default createEndpoint({
  description: 'Preaching data report across all FOLK centers with 9 weekly metrics',
  authenticated: true,
  inputSchema: z.object({ startDate: z.string(), endDate: z.string() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });
    const { startDate, endDate } = input;

    const yr = new Date().getFullYear();
    const [{ records: res }, roster, days, { records: goalRecs }] = await Promise.all([
      FolkResidencies.findAll({ filters: { isActive: true }, fields: ['id', 'residencyName'], limit: 200 }),
      loadPreachingRoster(),
      loadPreachingDays(startDate, endDate),
      PreachingReportGoals.findAll({ filters: { year: yr }, limit: 200 }),
    ]);
    const centers = res.map(r => ({ id: r.id, name: r.residencyName || '', shortName: stripFOLK(r.residencyName || '') }));
    const cidSet = new Set(centers.map(c => c.id));
    const allUsers = roster.users;
    const userResMap = new Map<string, string>();
    for (const u of allUsers) {
      if (u.residency && cidSet.has(u.residency)) userResMap.set(u.id, u.residency);
    }

    const weeks = computeWeeks(startDate, endDate);
    const initMx = (): Matrix => { const m: Matrix = new Map(); for (const c of centers) { const w: WMap = new Map(); for (const wk of weeks) w.set(wk.label, null); m.set(c.id, w); } return m; };

    // M1: Bs residents (snapshot)
    const m1 = new Map<string, number>(); for (const c of centers) m1.set(c.id, 0);
    for (const u of allUsers) { if (!u.isB || !u.residencyApproved || u.isOtherCenter) continue; if (u.residency && cidSet.has(u.residency)) m1.set(u.residency, (m1.get(u.residency) || 0) + 1); }

    // M8: Folk strength (snapshot)
    const m8 = new Map<string, number>(); for (const c of centers) m8.set(c.id, 0);
    for (const u of allUsers) { if (!u.residencyApproved || u.isOtherCenter) continue; if (u.residency && cidSet.has(u.residency)) m8.set(u.residency, (m8.get(u.residency) || 0) + 1); }

    const nrBIds = new Set(allUsers.filter(u => u.isB && !u.residencyApproved).map(u => u.id));
    const m2 = initMx(); const m2Seen = new Map<string, Set<string>>(); for (const w of weeks) m2Seen.set(w.label, new Set());
    const m9uw = new Map<string, Map<string, { sum: number; cnt: number }>>();
    const m3Mins = new Map<string, Map<string, number>>(); const m3Boys = new Map<string, Map<string, Set<string>>>();
    for (const c of centers) { m3Mins.set(c.id, new Map(weeks.map(w => [w.label, 0]))); m3Boys.set(c.id, new Map(weeks.map(w => [w.label, new Set()]))); }
    const m4 = initMx(); const m6 = initMx();
    const grpCtr = new Map<string, string>(); const m7 = new Map<string, number>(); for (const c of centers) m7.set(c.id, 0);
    for (const g of roster.groups) { const lid = g.bvslLeader; if (!lid) continue; const rid = userResMap.get(lid); if (!rid) continue; grpCtr.set(g.id, rid); m7.set(rid, (m7.get(rid) || 0) + 1); }
    const m5 = initMx();
    for (const [date, fact] of days) {
      const wk = findWk(date, weeks); if (!wk) continue;
      for (const [uid, sample] of Object.entries(fact.sadhana)) {
        if (nrBIds.has(uid)) {
          const seen = m2Seen.get(wk.label)!;
          if (!seen.has(uid)) { seen.add(uid); const rid = userResMap.get(uid); if (rid) addM(m2, rid, wk.label, 1); }
        }
        if (sample.roundsCount > 0 && userResMap.has(uid)) {
          if (!m9uw.has(uid)) m9uw.set(uid, new Map());
          const uw = m9uw.get(uid)!; if (!uw.has(wk.label)) uw.set(wk.label, { sum: 0, cnt: 0 });
          const en = uw.get(wk.label)!; en.sum += sample.roundsSum; en.cnt += sample.roundsCount;
        }
      }
      for (const [uid, activity] of Object.entries(fact.preaching)) {
        const rid = userResMap.get(uid); if (!rid) continue;
        m3Mins.get(rid)!.set(wk.label, (m3Mins.get(rid)!.get(wk.label) || 0) + activity.minutes);
        m3Boys.get(rid)!.get(wk.label)!.add(uid);
        if (activity.oneOnOnes) addM(m4, rid, wk.label, activity.oneOnOnes);
        if (activity.books) addM(m6, rid, wk.label, activity.books);
      }
      for (const [gid, count] of Object.entries(fact.attendance)) {
        if (!count) continue;
        const rid = grpCtr.get(gid); if (!rid) continue;
        addM(m5, rid, wk.label, count);
      }
    }
    const m9 = initMx();
    for (const [uid, wkMap] of m9uw) { const rid = userResMap.get(uid); if (!rid) continue; for (const [wl, { sum, cnt }] of wkMap) { if (cnt > 0 && sum / cnt >= 16) addM(m9, rid, wl, 1); } }
    const goals = goalRecs.map(g => ({ metricName: g.metricName || '', centerId: (Array.isArray(g.center) ? g.center[0] : g.center) || '', yearlyGoal: Number(g.yearlyGoal) || 0, initialValue: Number(g.initialValue) || 0 }));
    const gMap = new Map<string, { yearlyGoal: number; initial: number }>();
    for (const g of goals) gMap.set(`${g.metricName}::${g.centerId}`, { yearlyGoal: g.yearlyGoal, initial: g.initialValue });
    const getG = (k: string, cid: string) => gMap.get(`${k}::${cid}`) || { yearlyGoal: 0, initial: 0 };

    const snapRows = (key: string, cnt: Map<string, number>) => centers.map(c => {
      const val = cnt.get(c.id) || 0; const g = getG(key, c.id);
      const wd: Record<string, number | null> = {}; for (const w of weeks) wd[w.label] = val;
      return { centerId: c.id, centerName: c.shortName, yearlyGoal: g.yearlyGoal, initial: g.initial, cumulative: val, weeklyData: wd };
    });

    const mxRows = (key: string, mx: Matrix) => centers.map(c => {
      const row = mx.get(c.id)!; const g = getG(key, c.id);
      const wd: Record<string, number | null> = {}; let cum = 0;
      for (const w of weeks) { const v = row.get(w.label) ?? null; wd[w.label] = v; if (v != null) cum += v; }
      return { centerId: c.id, centerName: c.shortName, yearlyGoal: g.yearlyGoal, initial: g.initial, cumulative: Math.round(cum * 10) / 10, weeklyData: wd };
    });

    const m3Rows = centers.map(c => {
      const g = getG('Avg Hours Preaching', c.id); const wd: Record<string, number | null> = {}; let cum = 0;
      for (const w of weeks) {
        const mins = m3Mins.get(c.id)!.get(w.label) || 0; const boys = m3Boys.get(c.id)!.get(w.label)!.size;
        if (boys > 0) { const avg = Math.round(mins / 60 / boys * 10) / 10; wd[w.label] = avg; cum += avg; } else wd[w.label] = null;
      }
      return { centerId: c.id, centerName: c.shortName, yearlyGoal: g.yearlyGoal, initial: g.initial, cumulative: Math.round(cum * 10) / 10, weeklyData: wd };
    });

    const m7Rows = centers.map(c => { const val = m7.get(c.id) || 0; const g = getG('No of BV Groups', c.id); const wd: Record<string, number | null> = {}; for (const w of weeks) wd[w.label] = val; return { centerId: c.id, centerName: c.shortName, yearlyGoal: g.yearlyGoal, initial: g.initial, cumulative: val, weeklyData: wd }; });

    return {
      centers, weeks, goals,
      metrics: [
        { key: 'Folk Residency Strength Bs', label: "Folk Residency Strength - B's", rows: snapRows('Folk Residency Strength Bs', m1) },
        { key: 'No of Bs Non Residents', label: "No. of B's (Non Residents)", rows: mxRows('No of Bs Non Residents', m2) },
        { key: 'Avg Hours Preaching', label: 'Avg. Hours on Preaching/week', rows: m3Rows },
        { key: 'No of Meetings', label: 'No. of Meetings', rows: mxRows('No of Meetings', m4) },
        { key: 'BV Groups Attendance', label: 'BV Groups Attendance/week', rows: mxRows('BV Groups Attendance', m5) },
        { key: 'Books Distributed', label: 'Books Distributed/week', rows: mxRows('Books Distributed', m6) },
        { key: 'No of BV Groups', label: 'No. of BV Groups', rows: m7Rows },
        { key: 'Folk Residency Strength', label: 'Folk Residency Strength', rows: snapRows('Folk Residency Strength', m8) },
        { key: 'Boys Chanting 16 Rounds', label: 'Boys Chanting 16 Rounds', rows: mxRows('Boys Chanting 16 Rounds', m9) },
      ],
    };
  },
});
