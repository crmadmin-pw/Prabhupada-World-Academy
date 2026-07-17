import { z } from 'zod';
import {
  createEndpoint, FolkResidencies, Users, BvslPreachingEntries,
  BvAttendance, BvGroups, SadhanaEntries, PreachingReportGoals,
} from 'zite-integrations-backend-sdk';
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

async function fetchAll<T>(fn: (off: number) => Promise<{ records: T[]; hasMore: boolean }>): Promise<T[]> {
  const all: T[] = []; let off = 0;
  while (true) { const { records, hasMore } = await fn(off); all.push(...records); if (!hasMore || !records.length) break; off += records.length; }
  return all;
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

    // Centers
    const { records: res } = await FolkResidencies.findAll({ filters: { isActive: true }, fields: ['id', 'residencyName'], limit: 200 });
    const centers = res.map(r => ({ id: r.id, name: r.residencyName || '', shortName: stripFOLK(r.residencyName || '') }));
    const cidSet = new Set(centers.map(c => c.id));

    // All active users
    const allUsers = await fetchAll(off => Users.findAll({ filters: { status: 'Active' }, fields: ['id', 'residency', 'residencyApproved', 'isB', 'isBvsl', 'isOtherCenter'], limit: 2000, offset: off }));
    const userResMap = new Map<string, string>();
    for (const u of allUsers) {
      const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency;
      if (rid && cidSet.has(rid as string)) userResMap.set(u.id, rid as string);
    }

    const weeks = computeWeeks(startDate, endDate);
    const initMx = (): Matrix => { const m: Matrix = new Map(); for (const c of centers) { const w: WMap = new Map(); for (const wk of weeks) w.set(wk.label, null); m.set(c.id, w); } return m; };

    // M1: Bs residents (snapshot)
    const m1 = new Map<string, number>(); for (const c of centers) m1.set(c.id, 0);
    for (const u of allUsers) { if (!u.isB || !u.residencyApproved || (u as any).isOtherCenter) continue; const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency; if (rid && cidSet.has(rid as string)) m1.set(rid as string, (m1.get(rid as string) || 0) + 1); }

    // M8: Folk strength (snapshot)
    const m8 = new Map<string, number>(); for (const c of centers) m8.set(c.id, 0);
    for (const u of allUsers) { if (!u.residencyApproved || (u as any).isOtherCenter) continue; const rid = Array.isArray(u.residency) ? u.residency[0] : u.residency; if (rid && cidSet.has(rid as string)) m8.set(rid as string, (m8.get(rid as string) || 0) + 1); }

    // Sadhana entries (M2 + M9)
    const sadh = await fetchAll(off => SadhanaEntries.findAll({ filters: { entryDate: { gte: startDate, lte: endDate } } as any, fields: ['id', 'user', 'entryDate', 'roundsCount'], limit: 2000, offset: off }));

    // M2: Bs non-residents
    const nrBIds = new Set(allUsers.filter(u => u.isB && !u.residencyApproved).map(u => u.id));
    const m2 = initMx(); const m2Seen = new Map<string, Set<string>>(); for (const w of weeks) m2Seen.set(w.label, new Set());
    for (const e of sadh) {
      if (!e.entryDate) continue;
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
      if (!uid || !nrBIds.has(uid)) continue;
      const wk = findWk(e.entryDate, weeks); if (!wk) continue;
      const seen = m2Seen.get(wk.label)!; if (seen.has(uid)) continue; seen.add(uid);
      const rid = userResMap.get(uid); if (rid) addM(m2, rid, wk.label, 1);
    }

    // M9: Boys chanting 16 rounds
    const m9uw = new Map<string, Map<string, { sum: number; cnt: number }>>();
    for (const e of sadh) {
      if (!e.entryDate || e.roundsCount == null) continue;
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string);
      if (!uid || !userResMap.has(uid)) continue;
      const wk = findWk(e.entryDate, weeks); if (!wk) continue;
      if (!m9uw.has(uid)) m9uw.set(uid, new Map());
      const uw = m9uw.get(uid)!; if (!uw.has(wk.label)) uw.set(wk.label, { sum: 0, cnt: 0 });
      const en = uw.get(wk.label)!; en.sum += Number(e.roundsCount) || 0; en.cnt++;
    }
    const m9 = initMx();
    for (const [uid, wkMap] of m9uw) { const rid = userResMap.get(uid); if (!rid) continue; for (const [wl, { sum, cnt }] of wkMap) { if (cnt > 0 && sum / cnt >= 16) addM(m9, rid, wl, 1); } }

    // Preaching entries (M3, M4, M6)
    const prch = await fetchAll(off => BvslPreachingEntries.findAll({ filters: { entryDate: { gte: startDate, lte: endDate } } as any, fields: ['id', 'user', 'entryDate', 'prCallingTime', 'prOneOnOneTime', 'prBookDistTime', 'prRduaTime', 'prPlanTime', 'prBooksDistributed', 'prUniqueOneOnOnes'], limit: 2000, offset: off }));
    const m3Mins = new Map<string, Map<string, number>>(); const m3Boys = new Map<string, Map<string, Set<string>>>();
    for (const c of centers) { m3Mins.set(c.id, new Map(weeks.map(w => [w.label, 0]))); m3Boys.set(c.id, new Map(weeks.map(w => [w.label, new Set()]))); }
    const m4 = initMx(); const m6 = initMx();
    for (const e of prch) {
      if (!e.entryDate) continue;
      const uid = Array.isArray(e.user) ? e.user[0] : (e.user as string); if (!uid) continue;
      const rid = userResMap.get(uid); if (!rid) continue;
      const wk = findWk(e.entryDate, weeks); if (!wk) continue;
      const mins = (Number(e.prCallingTime) || 0) + (Number(e.prOneOnOneTime) || 0) + (Number(e.prBookDistTime) || 0) + (Number(e.prRduaTime) || 0) + (Number(e.prPlanTime) || 0);
      m3Mins.get(rid)!.set(wk.label, (m3Mins.get(rid)!.get(wk.label) || 0) + mins);
      m3Boys.get(rid)!.get(wk.label)!.add(uid);
      if (e.prUniqueOneOnOnes) addM(m4, rid, wk.label, Number(e.prUniqueOneOnOnes) || 0);
      if (e.prBooksDistributed) addM(m6, rid, wk.label, Number(e.prBooksDistributed) || 0);
    }

    // BV Groups (M5, M7)
    const { records: grps } = await BvGroups.findAll({ filters: { isActive: true }, fields: ['id', 'bvslLeader'], limit: 2000 });
    const grpCtr = new Map<string, string>(); const m7 = new Map<string, number>(); for (const c of centers) m7.set(c.id, 0);
    for (const g of grps) { const lid = Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : (g.bvslLeader as string); if (!lid) continue; const rid = userResMap.get(lid); if (!rid) continue; grpCtr.set(g.id, rid); m7.set(rid, (m7.get(rid) || 0) + 1); }
    const m5 = initMx();
    const att = await fetchAll(off => BvAttendance.findAll({ filters: { attendanceDate: { gte: startDate, lte: endDate } } as any, fields: ['id', 'group', 'present', 'attendanceDate'], limit: 2000, offset: off }));
    for (const a of att) {
      if (!a.attendanceDate || !a.present) continue;
      const gid = Array.isArray(a.group) ? a.group[0] : (a.group as string); if (!gid) continue;
      const rid = grpCtr.get(gid); if (!rid) continue;
      const wk = findWk(a.attendanceDate, weeks); if (!wk) continue;
      addM(m5, rid, wk.label, 1);
    }

    // Goals
    const yr = new Date().getFullYear();
    const { records: goalRecs } = await PreachingReportGoals.findAll({ filters: { year: yr }, limit: 200 });
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
