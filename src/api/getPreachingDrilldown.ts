import { z } from 'zod';
import {
  createEndpoint, Users, BvslPreachingEntries,
  BvAttendance, BvGroups, SadhanaEntries,
} from 'zite-integrations-backend-sdk';
import { requireGuideRole } from '../lib/userUtils';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtD(s: string) { const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

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
  return weeks;
}

async function fetchAll<T>(fn: (off: number) => Promise<{ records: T[]; hasMore: boolean }>): Promise<T[]> {
  const all: T[] = []; let off = 0;
  while (true) { const { records, hasMore } = await fn(off); all.push(...records); if (!hasMore || !records.length) break; off += records.length; }
  return all;
}

type UserResult = { userId: string; fullName: string; phone: string; email: string; detail?: string };
type AnyUser = { id: string; fullName?: string; phone?: string; email?: string; isB?: boolean; isBvsl?: boolean; residencyApproved?: boolean; isOtherCenter?: boolean };
function toUser(u: AnyUser, detail?: string): UserResult {
  return { userId: u.id, fullName: u.fullName || '', phone: u.phone || '', email: u.email || '', ...(detail != null ? { detail } : {}) };
}

export default createEndpoint({
  description: 'Drill-down for a preaching metric cell — returns the individual people behind an aggregate number',
  authenticated: true,
  inputSchema: z.object({
    metricKey: z.string(),
    centerId: z.string(),
    weekLabel: z.string().optional(),
    startDate: z.string(),
    endDate: z.string(),
  }),
  outputSchema: z.object({
    users: z.array(z.object({
      userId: z.string(),
      fullName: z.string(),
      phone: z.string(),
      email: z.string(),
      detail: z.string().optional(),
    })),
  }),
  execute: async ({ input, context }) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const { metricKey, centerId, weekLabel, startDate, endDate } = input;

    // Resolve week date range from label
    let weekStart: string | null = null;
    let weekEnd: string | null = null;
    if (weekLabel) {
      const wk = computeWeeks(startDate, endDate).find(w => w.label === weekLabel);
      if (wk) { weekStart = wk.start; weekEnd = wk.end; }
    }

    // Fetch all active users in this center
    const allUsers = await fetchAll(off => Users.findAll({
      filters: { status: 'Active', residency: centerId },
      fields: ['id', 'fullName', 'phone', 'email', 'isB', 'isBvsl', 'residencyApproved', 'isOtherCenter'],
      limit: 2000, offset: off,
    }));
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const bvslIds = new Set(allUsers.filter(u => u.isBvsl).map(u => u.id));
    const empty = (): { users: UserResult[] } => ({ users: [] });

    // ── Snapshot metrics ──────────────────────────────────────────────────────

    if (metricKey === 'Folk Residency Strength Bs') {
      return { users: allUsers.filter(u => u.isB && u.residencyApproved && !u.isOtherCenter).map(u => toUser(u)) };
    }

    if (metricKey === 'Folk Residency Strength') {
      return { users: allUsers.filter(u => u.residencyApproved && !u.isOtherCenter).map(u => toUser(u)) };
    }

    if (metricKey === 'No of BV Groups') {
      const { records: grps } = await BvGroups.findAll({
        filters: { isActive: true }, fields: ['id', 'groupName', 'bvslLeader'], limit: 500,
      });
      return {
        users: grps
          .filter(g => { const lid = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string; return lid && bvslIds.has(lid); })
          .map(g => {
            const lid = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string;
            const leader = userMap.get(lid);
            return { userId: g.id, fullName: g.groupName || 'Unnamed Group', phone: leader?.phone || '', email: leader?.email || '', detail: leader?.fullName || '' };
          }),
      };
    }

    // ── Weekly metrics — require a resolved week range ─────────────────────────
    if (!weekStart || !weekEnd) return empty();

    // No of Bs Non Residents: non-approved B's who submitted sadhana this week
    if (metricKey === 'No of Bs Non Residents') {
      const nrBs = allUsers.filter(u => u.isB && !u.residencyApproved);
      if (!nrBs.length) return empty();
      const nrBIds = nrBs.map(u => u.id);
      const sadh = await fetchAll(off => SadhanaEntries.findAll({
        filters: { entryDate: { gte: weekStart!, lte: weekEnd! } as any, user: { in: nrBIds } as any },
        fields: ['user'], limit: 2000, offset: off,
      }));
      const submitted = new Set(sadh.map(e => (Array.isArray(e.user) ? e.user[0] : e.user) as string).filter(Boolean));
      return { users: nrBs.filter(u => submitted.has(u.id)).map(u => toUser(u)) };
    }

    // Avg Hours Preaching: BVSLs with preaching entries, showing their total hours
    if (metricKey === 'Avg Hours Preaching') {
      if (!bvslIds.size) return empty();
      const prch = await fetchAll(off => BvslPreachingEntries.findAll({
        filters: { entryDate: { gte: weekStart!, lte: weekEnd! } as any, user: { in: [...bvslIds] } as any },
        fields: ['user', 'prCallingTime', 'prOneOnOneTime', 'prBookDistTime', 'prRduaTime', 'prPlanTime'],
        limit: 2000, offset: off,
      }));
      const minsMap = new Map<string, number>();
      for (const e of prch) {
        const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string; if (!uid) continue;
        const m = (Number(e.prCallingTime)||0)+(Number(e.prOneOnOneTime)||0)+(Number(e.prBookDistTime)||0)+(Number(e.prRduaTime)||0)+(Number(e.prPlanTime)||0);
        minsMap.set(uid, (minsMap.get(uid) || 0) + m);
      }
      return { users: [...minsMap.entries()].flatMap(([uid, mins]) => { const u = userMap.get(uid); if (!u) return []; return [toUser(u, `${Math.round(mins/60*10)/10} hrs`)]; }) };
    }

    // No of Meetings: BVSLs with unique one-on-ones logged
    if (metricKey === 'No of Meetings') {
      if (!bvslIds.size) return empty();
      const prch = await fetchAll(off => BvslPreachingEntries.findAll({
        filters: { entryDate: { gte: weekStart!, lte: weekEnd! } as any, user: { in: [...bvslIds] } as any },
        fields: ['user', 'prUniqueOneOnOnes'], limit: 2000, offset: off,
      }));
      const meetMap = new Map<string, number>();
      for (const e of prch) {
        const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
        if (!uid || !e.prUniqueOneOnOnes) continue;
        meetMap.set(uid, (meetMap.get(uid) || 0) + (Number(e.prUniqueOneOnOnes) || 0));
      }
      return { users: [...meetMap.entries()].flatMap(([uid, cnt]) => { const u = userMap.get(uid); if (!u) return []; return [toUser(u, `${cnt} meetings`)]; }) };
    }

    // BV Groups Attendance: unique attendees of groups belonging to this center's BVSLs
    if (metricKey === 'BV Groups Attendance') {
      if (!bvslIds.size) return empty();
      const { records: grps } = await BvGroups.findAll({ filters: { isActive: true }, fields: ['id', 'groupName', 'bvslLeader'], limit: 500 });
      const centerGroups = new Map<string, string>(); // groupId → groupName
      for (const g of grps) {
        const lid = (Array.isArray(g.bvslLeader) ? g.bvslLeader[0] : g.bvslLeader) as string;
        if (lid && bvslIds.has(lid)) centerGroups.set(g.id, g.groupName || 'Group');
      }
      if (!centerGroups.size) return empty();
      const att = await fetchAll(off => BvAttendance.findAll({
        filters: { attendanceDate: { gte: weekStart!, lte: weekEnd! } as any, group: { in: [...centerGroups.keys()] } as any },
        fields: ['user', 'group', 'present'], limit: 2000, offset: off,
      }));
      const userInfo = new Map<string, { groupName: string; sessions: number }>();
      for (const a of att) {
        if (!a.present) continue;
        const gid = (Array.isArray(a.group) ? a.group[0] : a.group) as string;
        const uid = (Array.isArray(a.user) ? a.user[0] : a.user) as string;
        if (!gid || !uid || !centerGroups.has(gid)) continue;
        const prev = userInfo.get(uid);
        if (prev) prev.sessions++;
        else userInfo.set(uid, { groupName: centerGroups.get(gid)!, sessions: 1 });
      }
      if (!userInfo.size) return empty();
      const { records: attendees } = await Users.findAll({ filters: { id: { in: [...userInfo.keys()] } as any }, fields: ['id', 'fullName', 'phone', 'email'], limit: 2000 });
      return {
        users: attendees.map(u => {
          const info = userInfo.get(u.id)!;
          return toUser(u, info.sessions > 1 ? `${info.groupName} (${info.sessions} sessions)` : info.groupName);
        }),
      };
    }

    // Books Distributed: BVSLs who distributed books this week
    if (metricKey === 'Books Distributed') {
      if (!bvslIds.size) return empty();
      const prch = await fetchAll(off => BvslPreachingEntries.findAll({
        filters: { entryDate: { gte: weekStart!, lte: weekEnd! } as any, user: { in: [...bvslIds] } as any },
        fields: ['user', 'prBooksDistributed'], limit: 2000, offset: off,
      }));
      const booksMap = new Map<string, number>();
      for (const e of prch) {
        const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
        if (!uid || !e.prBooksDistributed) continue;
        booksMap.set(uid, (booksMap.get(uid) || 0) + (Number(e.prBooksDistributed) || 0));
      }
      return { users: [...booksMap.entries()].flatMap(([uid, cnt]) => { const u = userMap.get(uid); if (!u) return []; return [toUser(u, `${cnt} books`)]; }) };
    }

    // Boys Chanting 16 Rounds: users in this center averaging ≥16 rounds this week
    if (metricKey === 'Boys Chanting 16 Rounds') {
      const userIds = allUsers.map(u => u.id);
      if (!userIds.length) return empty();
      const sadh = await fetchAll(off => SadhanaEntries.findAll({
        filters: { entryDate: { gte: weekStart!, lte: weekEnd! } as any, user: { in: userIds } as any },
        fields: ['user', 'roundsCount'], limit: 2000, offset: off,
      }));
      const roundsMap = new Map<string, { sum: number; cnt: number }>();
      for (const e of sadh) {
        const uid = (Array.isArray(e.user) ? e.user[0] : e.user) as string;
        if (!uid || e.roundsCount == null) continue;
        const r = roundsMap.get(uid) || { sum: 0, cnt: 0 }; r.sum += Number(e.roundsCount)||0; r.cnt++;
        roundsMap.set(uid, r);
      }
      return {
        users: [...roundsMap.entries()].flatMap(([uid, { sum, cnt }]) => {
          if (!cnt || sum / cnt < 16) return [];
          const u = userMap.get(uid); if (!u) return [];
          return [toUser(u, `Avg ${Math.round(sum/cnt*10)/10} rounds`)];
        }),
      };
    }

    return empty();
  },
});
