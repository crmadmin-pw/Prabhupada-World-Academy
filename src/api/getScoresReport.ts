import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { supabase, fetchAllRows } from '../utils/supabase';
import { requireGuideRole } from '../lib/userUtils';

const TARGET_SLUGS = ['powai', 'vashi', 'sion', 'airoli', 'thane'];

const POSITIVE_OUTCOMES = ['Confirmed', 'Confirmed – Will Attend Online', 'I Will Attend Next Time'];
const NEUTRAL_OUTCOMES = ['Call Back Later', 'Maybe (Follow-up again)', 'Out of Town'];
const NEGATIVE_OUTCOMES = ['Not Coming', 'Remove Contact'];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}
function toDateStr(d: Date) { return d.toISOString().split('T')[0]; }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtD(s: string) { const d = new Date(s + 'T00:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }

function buildWeeks(from: string, to: string) {
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  let cursor = getMonday(start);
  const weeks: { id: string; start: string; end: string }[] = [];
  while (cursor <= end) {
    const ws = toDateStr(cursor);
    const we = new Date(cursor); we.setDate(we.getDate() + 6);
    const weStr = toDateStr(we);
    if (weStr >= from && ws <= to) {
      weeks.push({ id: `${fmtD(ws)} - ${fmtD(weStr)}`, start: ws, end: weStr });
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  // Most recent week first
  weeks.reverse();
  return weeks;
}

function findWeek(dateStr: string, weeks: { id: string; start: string; end: string }[]): string | null {
  for (const w of weeks) { if (dateStr >= w.start && dateStr <= w.end) return w.id; }
  return null;
}

function callPoints(outcome: string | null): number {
  if (!outcome) return 0;
  if (POSITIVE_OUTCOMES.includes(outcome)) return 2;
  if (NEUTRAL_OUTCOMES.includes(outcome)) return 1;
  if (NEGATIVE_OUTCOMES.includes(outcome)) return 0.5;
  return 0; // No answer types
}

export default createEndpoint({
  description: '7-metric volunteer-level weekly scores from Supabase FOLKHub data',
  authenticated: true,
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const today = new Date();
    const fourWeeksAgo = new Date(today); fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const from = input.from || toDateStr(fourWeeksAgo);
    const to = input.to || toDateStr(today);

    const isMock = !process.env.ZITE_SUPABASE_URL || process.env.ZITE_SUPABASE_URL.includes('mockproject');

    if (isMock) {
      const mockVolunteers = [
        { id: 'v1', name: 'Rohit Dasa', centerId: 'c1', centerName: 'Powai', teamId: 't1', teamName: 'Powai Team A' },
        { id: 'v2', name: 'Virat Dasa', centerId: 'c1', centerName: 'Powai', teamId: 't1', teamName: 'Powai Team A' },
        { id: 'v3', name: 'Rahul Dasa', centerId: 'c2', centerName: 'Vashi', teamId: 't2', teamName: 'Vashi Team A' },
        { id: 'v4', name: 'Bumrah Dasa', centerId: 'c2', centerName: 'Vashi', teamId: 't2', teamName: 'Vashi Team A' },
        { id: 'v5', name: 'Jadeja Dasa', centerId: 'c3', centerName: 'Sion', teamId: 't3', teamName: 'Sion Team A' },
        { id: 'v6', name: 'Hardik Dasa', centerId: 'c4', centerName: 'Airoli', teamId: 't4', teamName: 'Airoli Team A' },
        { id: 'v7', name: 'Shubman Dasa', centerId: 'c5', centerName: 'Thane', teamId: 't5', teamName: 'Thane Team A' },
        { id: 'v8', name: 'Suryakumar Dasa', centerId: 'c5', centerName: 'Thane', teamId: 't5', teamName: 'Thane Team A' },
      ];

      const scoresList: any[] = [];
      const weeksList = buildWeeks(from, to);

      const seedRandom = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        return () => {
          hash = (hash * 9301 + 49297) % 233280;
          return hash / 233280;
        };
      };

      const rand = seedRandom(from + to);

      for (const vol of mockVolunteers) {
        for (const w of weeksList) {
          scoresList.push({
            volunteerId: vol.id,
            volunteerName: vol.name,
            teamId: vol.teamId,
            teamName: vol.teamName,
            centerId: vol.centerId,
            centerName: vol.centerName,
            weekId: w.id,
            weekStart: w.start,
            weekEnd: w.end,
            booksPoints: Math.floor(rand() * 80) + 20,
            booksCount: Math.floor(rand() * 40) + 10,
            contactsPoints: Math.floor(rand() * 15) + 5,
            contactsCount: Math.floor(rand() * 10) + 2,
            attendancePoints: Math.floor(rand() * 50) + 10,
            newLeadsPoints: Math.floor(rand() * 20) + 5,
            oneOnOnePoints: Math.floor(rand() * 15) + 5,
            overnightStaysPoints: Math.floor(rand() * 10) + 2,
            callingPoints: Math.floor(rand() * 30) + 5,
            callingCount: Math.floor(rand() * 40) + 10,
          });
        }
      }
      return { scores: scoresList, weeks: weeksList };
    }

    // Centers & volunteers
    const { data: centersData } = await supabase.from('centers').select('id,name,slug').in('slug', TARGET_SLUGS);
    const centers = (centersData || []) as { id: string; name: string; slug: string }[];
    const centerIds = centers.map(c => c.id);
    const centerMap = new Map(centers.map(c => [c.id, c.name.replace(/^FOLK\s+/i, '')]));

    const volunteers = await fetchAllRows<any>(
      (f, t) => supabase.from('volunteers').select('id,volunteer_id,volunteer_name,phone,team_id,center_id,is_active')
        .in('center_id', centerIds).range(f, t)
    );
    const volMap = new Map(volunteers.map(v => [v.volunteer_id, v]));
    const volPhones = new Set(volunteers.filter(v => v.phone).map(v => String(v.phone)));

    // Teams
    const { data: teamsData } = await supabase.from('teams').select('team_id,team_name,center_id').in('center_id', centerIds);
    const teamMap = new Map((teamsData || []).map((t: any) => [t.team_id, t]));

    const weeks = buildWeeks(from, to);

    // Key: `${volunteerId}::${weekId}`
    type ScoreRow = {
      volunteerId: string; volunteerName: string; teamId: string; teamName: string;
      centerId: string; centerName: string; weekId: string; weekStart: string; weekEnd: string;
      booksPoints: number; booksCount: number;
      contactsPoints: number; contactsCount: number;
      attendancePoints: number; newLeadsPoints: number;
      oneOnOnePoints: number; overnightStaysPoints: number;
      callingPoints: number; callingCount: number;
    };
    const scoreMap = new Map<string, ScoreRow>();

    function getOrCreate(volId: string, weekId: string): ScoreRow | null {
      const key = `${volId}::${weekId}`;
      if (scoreMap.has(key)) return scoreMap.get(key)!;
      const vol = volMap.get(volId);
      if (!vol) return null;
      const team = teamMap.get(vol.team_id);
      const week = weeks.find(w => w.id === weekId);
      if (!week) return null;
      const row: ScoreRow = {
        volunteerId: volId, volunteerName: vol.volunteer_name || volId,
        teamId: vol.team_id || '', teamName: team?.team_name || '',
        centerId: vol.center_id, centerName: centerMap.get(vol.center_id) || '',
        weekId, weekStart: week.start, weekEnd: week.end,
        booksPoints: 0, booksCount: 0, contactsPoints: 0, contactsCount: 0,
        attendancePoints: 0, newLeadsPoints: 0, oneOnOnePoints: 0,
        overnightStaysPoints: 0, callingPoints: 0, callingCount: 0,
      };
      scoreMap.set(key, row);
      return row;
    }

    // ── M1: Books ──
    const books = await fetchAllRows<any>(
      (f, t) => supabase.from('book_distribution_log')
        .select('volunteer_id,date_of_distribution,quantity,calculated_book_points')
        .in('center_id', centerIds).gte('date_of_distribution', from).lte('date_of_distribution', to).range(f, t)
    );
    for (const b of books) {
      if (!b.volunteer_id) continue;
      const wid = findWeek(b.date_of_distribution, weeks);
      if (!wid) continue;
      const row = getOrCreate(b.volunteer_id, wid);
      if (!row) continue;
      row.booksPoints += Number(b.calculated_book_points) || 0;
      row.booksCount += Number(b.quantity) || 0;
    }

    // ── M2: Contacts ──
    const contacts = await fetchAllRows<any>(
      (f, t) => supabase.from('contacts')
        .select('id,contact_id,brought_by_volunteer_id,contact_points,took_book,organisation_name,age_bracket,marital_status,photo_url,created_at,center_id')
        .in('center_id', centerIds).gte('created_at', from + 'T00:00:00').lte('created_at', to + 'T23:59:59').range(f, t)
    );
    for (const c of contacts) {
      if (!c.brought_by_volunteer_id) continue;
      const createdDate = c.created_at ? c.created_at.split('T')[0] : null;
      if (!createdDate) continue;
      const wid = findWeek(createdDate, weeks);
      if (!wid) continue;
      const row = getOrCreate(c.brought_by_volunteer_id, wid);
      if (!row) continue;
      row.contactsCount++;
      if (c.contact_points != null && Number(c.contact_points) > 0) {
        row.contactsPoints += Number(c.contact_points);
      } else {
        let pts = 1;
        if (c.took_book) pts += 2;
        if (c.organisation_name) pts += 1;
        const ageNum = parseInt(c.age_bracket);
        if (!isNaN(ageNum) && ageNum < 30) pts += 1;
        if (c.marital_status && c.marital_status.toLowerCase().includes('unmarried')) pts += 1;
        if (c.photo_url) pts += 1;
        row.contactsPoints += pts;
      }
    }

    // ── M3: Attendance (brought_by) ──
    const attendance = await fetchAllRows<any>(
      (f, t) => supabase.from('attendance_log')
        .select('id,contact_id,contact_phone,session_date,present,center_id')
        .in('center_id', centerIds).eq('present', 'Yes')
        .gte('session_date', from).lte('session_date', to).range(f, t)
    );
    // Map contact_id → brought_by_volunteer_id from contacts table
    const contactBroughtBy = new Map<string, string>();
    const allContactIds = [...new Set(attendance.map(a => a.contact_id).filter(Boolean))];
    if (allContactIds.length > 0) {
      // Fetch in batches
      for (let i = 0; i < allContactIds.length; i += 500) {
        const batch = allContactIds.slice(i, i + 500);
        const contactsWithBrought = await fetchAllRows<any>(
          (f, t) => supabase.from('contacts').select('contact_id,brought_by_volunteer_id')
            .in('contact_id', batch).range(f, t)
        );
        for (const c of contactsWithBrought) {
          if (c.brought_by_volunteer_id) contactBroughtBy.set(c.contact_id, c.brought_by_volunteer_id);
        }
      }
    }

    // M4: New Leads detection - find first-ever attendance for all contacts in range
    const firstAttendanceMap = new Map<string, string>(); // contact_id → first session_date
    if (allContactIds.length > 0) {
      const allAttEver = await fetchAllRows<any>(
        (f, t) => supabase.from('attendance_log').select('contact_id,session_date')
          .in('contact_id', allContactIds).eq('present', 'Yes')
          .order('session_date', { ascending: true }).range(f, t)
      );
      for (const a of allAttEver) {
        if (a.contact_id && !firstAttendanceMap.has(a.contact_id)) {
          firstAttendanceMap.set(a.contact_id, a.session_date);
        }
      }
    }

    for (const a of attendance) {
      if (!a.contact_id) continue;
      const volId = contactBroughtBy.get(a.contact_id);
      if (!volId) continue;
      const wid = findWeek(a.session_date, weeks);
      if (!wid) continue;
      const row = getOrCreate(volId, wid);
      if (!row) continue;
      // Exclude volunteer phones from attendance count
      if (a.contact_phone && volPhones.has(String(a.contact_phone))) continue;
      row.attendancePoints++;

      // New Lead check
      const firstDate = firstAttendanceMap.get(a.contact_id);
      if (firstDate && firstDate >= from && firstDate <= to && firstDate === a.session_date) {
        row.newLeadsPoints++;
      }
    }

    // ── M5: 1-on-1s ──
    const oneOnOnes = await fetchAllRows<any>(
      (f, t) => supabase.from('one_on_one_logs').select('id,contact_id,log_date,logged_by_volunteer_id')
        .in('center_id', centerIds).gte('log_date', from).lte('log_date', to).range(f, t)
    );
    // Distinct contact per volunteer per week
    const oooSeen = new Map<string, Set<string>>(); // `volId::weekId` → Set<contactId>
    for (const o of oneOnOnes) {
      if (!o.logged_by_volunteer_id || !o.contact_id) continue;
      const wid = findWeek(o.log_date, weeks);
      if (!wid) continue;
      const key = `${o.logged_by_volunteer_id}::${wid}`;
      if (!oooSeen.has(key)) oooSeen.set(key, new Set());
      oooSeen.get(key)!.add(o.contact_id);
    }
    for (const [key, contactSet] of oooSeen) {
      const [volId, wid] = key.split('::');
      const row = getOrCreate(volId, wid);
      if (row) row.oneOnOnePoints = contactSet.size;
    }

    // ── M6: Overnight Stays ──
    try {
      const stays = await fetchAllRows<any>(
        (f, t) => supabase.from('overnight_stays').select('*').in('center_id', centerIds).range(f, t)
      );
      for (const s of stays) {
        const d = s.stay_date || s.date || (s.created_at ? s.created_at.split('T')[0] : null);
        if (!d || !s.volunteer_id) continue;
        const wid = findWeek(d, weeks);
        if (!wid) continue;
        const row = getOrCreate(s.volunteer_id, wid);
        if (row) row.overnightStaysPoints++;
      }
    } catch { /* empty table */ }

    // ── M7: Calling ──
    const calls = await fetchAllRows<any>(
      (f, t) => supabase.from('calling_log')
        .select('id,called_by_volunteer_id,contact_id,call_date,outcome,attended')
        .in('center_id', centerIds).gte('call_date', from).lte('call_date', to).range(f, t)
    );
    // Track follow-ups: same person, same week, second+ call → +0.5 bonus
    const callTracker = new Map<string, Set<string>>(); // `volId::weekId` → Set<contactId>
    for (const c of calls) {
      if (!c.called_by_volunteer_id) continue;
      const wid = findWeek(c.call_date, weeks);
      if (!wid) continue;
      const row = getOrCreate(c.called_by_volunteer_id, wid);
      if (!row) continue;
      row.callingCount++;
      let pts = callPoints(c.outcome);
      // Follow-up bonus
      const trackKey = `${c.called_by_volunteer_id}::${wid}`;
      if (!callTracker.has(trackKey)) callTracker.set(trackKey, new Set());
      const seen = callTracker.get(trackKey)!;
      if (c.contact_id && seen.has(c.contact_id)) {
        pts += 0.5; // follow-up same person same week
      }
      if (c.contact_id) seen.add(c.contact_id);
      // Attend bonus
      if (c.attended === true || c.attended === 'true' || c.attended === 'Yes') pts += 3;
      row.callingPoints += pts;
    }

    const scores = [...scoreMap.values()];

    // Center totals for attendance & new leads
    const centerTotals: { centerId: string; centerName: string; weekId: string; weekStart: string; weekEnd: string; attendance: number; newLeads: number }[] = [];
    for (const center of centers) {
      for (const week of weeks) {
        let att = 0, nl = 0;
        for (const s of scores) {
          if (s.centerId === center.id && s.weekId === week.id) {
            att += s.attendancePoints;
            nl += s.newLeadsPoints;
          }
        }
        centerTotals.push({
          centerId: center.id, centerName: centerMap.get(center.id) || '',
          weekId: week.id, weekStart: week.start, weekEnd: week.end,
          attendance: att, newLeads: nl,
        });
      }
    }

    return { scores, centerTotals, weeks: weeks.map(w => ({ id: w.id, start: w.start, end: w.end })) };
  },
});
