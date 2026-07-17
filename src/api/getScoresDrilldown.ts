import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { supabase, fetchAllRows } from '../utils/supabase';
import { requireGuideRole } from '../lib/userUtils';

async function getAttendanceCountsForContacts(contactIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!contactIds.length) return counts;
  const allAtt = await fetchAllRows<any>(
    (f, t) => supabase.from('attendance_log').select('contact_id')
      .in('contact_id', contactIds).eq('present', 'Yes').range(f, t)
  );
  for (const a of allAtt) {
    if (a.contact_id) counts.set(a.contact_id, (counts.get(a.contact_id) || 0) + 1);
  }
  return counts;
}

async function getContactDetailsMap(contactIds: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (!contactIds.length) return map;
  for (let i = 0; i < contactIds.length; i += 500) {
    const batch = contactIds.slice(i, i + 500);
    const rows = await fetchAllRows<any>(
      (f, t) => supabase.from('contacts')
        .select('contact_id,full_name,age_bracket,gender,organisation_name,source,status,marital_status,brought_by_volunteer_name,photo_url')
        .in('contact_id', batch).range(f, t)
    );
    for (const r of rows) if (r.contact_id) map.set(r.contact_id, r);
  }
  return map;
}

export default createEndpoint({
  description: 'Drill-down for scores report — returns actual records for a volunteer/metric/week',
  authenticated: true,
  inputSchema: z.object({
    metric: z.string(),
    volunteerId: z.string().optional(),
    centerId: z.string().optional(),
    teamId: z.string().optional(),
    weekStart: z.string(),
    weekEnd: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const { metric, volunteerId, centerId, teamId, weekStart, weekEnd } = input;

    const isMock = !process.env.ZITE_SUPABASE_URL || process.env.ZITE_SUPABASE_URL.includes('mockproject');

    if (isMock) {
      const mockContactNames = ['Rohit Sharma', 'Virat Kohli', 'K. L. Rahul', 'Jasprit Bumrah', 'R. Jadeja', 'Hardik Pandya', 'Rishabh Pant', 'Shubman Gill', 'Y. Jaiswal', 'Suryakumar Yadav', 'Axar Patel', 'Kuldeep Yadav', 'Mohammed Siraj', 'Shreyas Iyer', 'Mohammed Shami'];
      const mockBooks = ['Bhagavad Gita As It Is', 'Science of Self Realization', 'Krsna, The Supreme Personality of Godhead', 'Nectar of Instruction', 'Perfect Questions, Perfect Answers', 'Easy Journey to Other Planets'];

      if (metric === 'books') {
        const records = Array.from({ length: 5 }).map((_, i) => ({
          id: `book_${i}`,
          primary: mockBooks[i % mockBooks.length],
          secondary: `Qty: ${Math.floor(Math.random() * 5) + 1}`,
          detail: `Points: ${(i + 1) * 10}`,
          date: weekStart,
          badges: ['Book Preaching'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'contacts') {
        const records = Array.from({ length: 6 }).map((_, i) => ({
          id: `contact_${i}`,
          primary: mockContactNames[i % mockContactNames.length],
          secondary: `9190909090${String(i).padStart(2, '0')}`,
          detail: 'IIT Powai / VJTI',
          date: weekStart,
          badges: ['New Contact'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'attendance') {
        const records = Array.from({ length: 8 }).map((_, i) => ({
          id: `att_${i}`,
          primary: mockContactNames[(i + 3) % mockContactNames.length],
          secondary: 'Present at Sunday Feast class',
          detail: 'Points: 2',
          date: weekStart,
          badges: ['Class Attendance'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'newLeads') {
        const records = Array.from({ length: 4 }).map((_, i) => ({
          id: `lead_${i}`,
          primary: mockContactNames[(i + 6) % mockContactNames.length],
          secondary: 'First session check-in',
          detail: 'Points: 5',
          date: weekStart,
          badges: ['Lead Created'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'oneOnOne') {
        const records = Array.from({ length: 3 }).map((_, i) => ({
          id: `o2o_${i}`,
          primary: mockContactNames[(i + 9) % mockContactNames.length],
          secondary: 'Discussed daily sadhana checklist and japa chanting tips',
          detail: 'Points: 10',
          date: weekStart,
          badges: ['Good Conversation'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'overnightStays') {
        const records = Array.from({ length: 2 }).map((_, i) => ({
          id: `stay_${i}`,
          primary: mockContactNames[(i + 12) % mockContactNames.length],
          secondary: 'Stayed overnight at Thane center room 202',
          detail: 'Points: 5',
          date: weekStart,
          badges: ['Temple Stay'],
          extra: {},
        }));
        return { records };
      }

      if (metric === 'calling') {
        const records = Array.from({ length: 6 }).map((_, i) => ({
          id: `call_${i}`,
          primary: mockContactNames[(i + 2) % mockContactNames.length],
          secondary: 'Called devotee to invite for next program',
          detail: 'Outcome: Confirmed',
          date: weekStart,
          badges: ['Volunteer Call'],
          extra: {},
        }));
        return { records };
      }
    }

    // Get volunteer IDs to filter by
    let volIds: string[] = [];
    if (volunteerId) {
      volIds = [volunteerId];
    } else if (teamId) {
      const vols = await fetchAllRows<any>(
        (f, t) => supabase.from('volunteers').select('volunteer_id').eq('team_id', teamId).range(f, t)
      );
      volIds = vols.map(v => v.volunteer_id);
    } else if (centerId) {
      const vols = await fetchAllRows<any>(
        (f, t) => supabase.from('volunteers').select('volunteer_id').eq('center_id', centerId).range(f, t)
      );
      volIds = vols.map(v => v.volunteer_id);
    }
    if (!volIds.length) return { records: [], volunteers: [] };

    // ─── Center/Team level → volunteer breakdown ───
    if (!volunteerId && (centerId || teamId)) {
      const volDetails = await fetchAllRows<any>(
        (f, t) => supabase.from('volunteers').select('volunteer_id,volunteer_name,team_id')
          .in('volunteer_id', volIds).range(f, t)
      );

      if (metric === 'Books') {
        const books = await fetchAllRows<any>(
          (f, t) => supabase.from('book_distribution_log')
            .select('volunteer_id,quantity,calculated_book_points')
            .in('volunteer_id', volIds)
            .gte('date_of_distribution', weekStart).lte('date_of_distribution', weekEnd).range(f, t)
        );
        const agg = new Map<string, { points: number; count: number }>();
        for (const b of books) {
          const prev = agg.get(b.volunteer_id) || { points: 0, count: 0 };
          prev.points += Number(b.calculated_book_points) || 0;
          prev.count += Number(b.quantity) || 0;
          agg.set(b.volunteer_id, prev);
        }
        return {
          volunteers: volDetails.filter(v => agg.has(v.volunteer_id))
            .map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: agg.get(v.volunteer_id)!.points, count: agg.get(v.volunteer_id)!.count }))
            .sort((a, b) => b.points - a.points),
          records: [],
        };
      }

      if (metric === 'Calling') {
        const calls = await fetchAllRows<any>(
          (f, t) => supabase.from('calling_log')
            .select('called_by_volunteer_id,outcome')
            .in('called_by_volunteer_id', volIds)
            .gte('call_date', weekStart).lte('call_date', weekEnd).range(f, t)
        );
        const agg = new Map<string, { count: number }>();
        for (const c of calls) {
          const prev = agg.get(c.called_by_volunteer_id) || { count: 0 };
          prev.count++;
          agg.set(c.called_by_volunteer_id, prev);
        }
        return {
          volunteers: volDetails.filter(v => agg.has(v.volunteer_id))
            .map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: 0, count: agg.get(v.volunteer_id)!.count }))
            .sort((a, b) => b.count - a.count),
          records: [],
        };
      }

      if (metric === 'Contacts') {
        const ctcs = await fetchAllRows<any>(
          (f, t) => supabase.from('contacts')
            .select('brought_by_volunteer_id,contact_points')
            .in('brought_by_volunteer_id', volIds)
            .gte('created_at', weekStart + 'T00:00:00').lte('created_at', weekEnd + 'T23:59:59').range(f, t)
        );
        const agg = new Map<string, { points: number; count: number }>();
        for (const c of ctcs) {
          const prev = agg.get(c.brought_by_volunteer_id) || { points: 0, count: 0 };
          prev.points += Number(c.contact_points) || 0;
          prev.count++;
          agg.set(c.brought_by_volunteer_id, prev);
        }
        return {
          volunteers: volDetails.filter(v => agg.has(v.volunteer_id))
            .map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: agg.get(v.volunteer_id)!.points, count: agg.get(v.volunteer_id)!.count }))
            .sort((a, b) => b.points - a.points),
          records: [],
        };
      }

      if (metric === '1-on-1s') {
        const logs = await fetchAllRows<any>(
          (f, t) => supabase.from('one_on_one_logs')
            .select('logged_by_volunteer_id,contact_id')
            .in('logged_by_volunteer_id', volIds)
            .gte('log_date', weekStart).lte('log_date', weekEnd).range(f, t)
        );
        const agg = new Map<string, Set<string>>();
        for (const l of logs) {
          if (!l.contact_id) continue;
          if (!agg.has(l.logged_by_volunteer_id)) agg.set(l.logged_by_volunteer_id, new Set());
          agg.get(l.logged_by_volunteer_id)!.add(l.contact_id);
        }
        return {
          volunteers: volDetails.filter(v => agg.has(v.volunteer_id))
            .map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: agg.get(v.volunteer_id)!.size, count: agg.get(v.volunteer_id)!.size }))
            .sort((a, b) => b.count - a.count),
          records: [],
        };
      }

      // Attendance / New Leads at center/team → aggregate by volunteer
      if (metric === 'Attendance' || metric === 'New Leads') {
        const att = await fetchAllRows<any>(
          (f, t) => supabase.from('attendance_log')
            .select('contact_id,session_date')
            .in('center_id', centerId ? [centerId] : []).eq('present', 'Yes')
            .gte('session_date', weekStart).lte('session_date', weekEnd).range(f, t)
        );
        const contactIds = [...new Set(att.map(a => a.contact_id).filter(Boolean))] as string[];
        const contactBrought = new Map<string, string>();
        if (contactIds.length > 0) {
          for (let i = 0; i < contactIds.length; i += 500) {
            const batch = contactIds.slice(i, i + 500);
            const rows = await fetchAllRows<any>(
              (f, t) => supabase.from('contacts').select('contact_id,brought_by_volunteer_id')
                .in('contact_id', batch).range(f, t)
            );
            for (const r of rows) if (r.brought_by_volunteer_id) contactBrought.set(r.contact_id, r.brought_by_volunteer_id);
          }
        }
        const volIdSet = new Set(volIds);
        const agg = new Map<string, number>();
        for (const a of att) {
          if (!a.contact_id) continue;
          const bv = contactBrought.get(a.contact_id);
          if (bv && volIdSet.has(bv)) agg.set(bv, (agg.get(bv) || 0) + 1);
        }
        return {
          volunteers: volDetails.filter(v => agg.has(v.volunteer_id))
            .map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: agg.get(v.volunteer_id)!, count: agg.get(v.volunteer_id)! }))
            .sort((a, b) => b.count - a.count),
          records: [],
        };
      }

      // Generic fallback
      return {
        volunteers: volDetails.map(v => ({ id: v.volunteer_id, name: v.volunteer_name, points: 0, count: 0 })),
        records: [],
      };
    }

    // ─── Individual level — return actual records ───
    if (!volunteerId) return { records: [], volunteers: [] };

    if (metric === 'Books') {
      const books = await fetchAllRows<any>(
        (f, t) => supabase.from('book_distribution_log')
          .select('id,book_name,quantity,calculated_book_points,date_of_distribution,source,contact_name')
          .eq('volunteer_id', volunteerId)
          .gte('date_of_distribution', weekStart).lte('date_of_distribution', weekEnd)
          .order('date_of_distribution', { ascending: false }).range(f, t)
      );
      return {
        records: books.map(b => ({
          id: b.id, primary: b.book_name || 'Book', secondary: `Qty: ${b.quantity}`,
          detail: `${b.calculated_book_points} pts`, date: b.date_of_distribution,
          badges: [b.source].filter(Boolean),
          extra: { contactName: b.contact_name || null, quantity: b.quantity, points: b.calculated_book_points },
        })),
        volunteers: [],
      };
    }

    if (metric === 'Contacts') {
      const ctcs = await fetchAllRows<any>(
        (f, t) => supabase.from('contacts')
          .select('id,contact_id,full_name,phone,contact_points,took_book,organisation_name,photo_url,created_at,age_bracket,gender,marital_status,source,status')
          .eq('brought_by_volunteer_id', volunteerId)
          .gte('created_at', weekStart + 'T00:00:00').lte('created_at', weekEnd + 'T23:59:59')
          .order('created_at', { ascending: false }).range(f, t)
      );

      // Get attendance counts for these contacts
      const cids = ctcs.map(c => c.contact_id).filter(Boolean) as string[];
      const visitCounts = await getAttendanceCountsForContacts(cids);

      return {
        records: ctcs.map(c => ({
          id: c.id, primary: c.full_name || 'Unknown', secondary: c.phone ? String(c.phone) : '',
          detail: `${c.contact_points || 0} pts`, date: c.created_at?.split('T')[0] || '',
          badges: [c.took_book ? 'Took Book' : '', c.status || ''].filter(Boolean),
          extra: {
            age: c.age_bracket || null,
            gender: c.gender || null,
            org: c.organisation_name || null,
            marital: c.marital_status || null,
            source: c.source || null,
            status: c.status || null,
            visits: c.contact_id ? visitCounts.get(c.contact_id) || 0 : 0,
            points: c.contact_points || 0,
          },
        })),
        volunteers: [],
      };
    }

    if (metric === 'Calling') {
      const calls = await fetchAllRows<any>(
        (f, t) => supabase.from('calling_log')
          .select('id,contact_name,contact_phone,outcome,call_date,attended,notes')
          .eq('called_by_volunteer_id', volunteerId)
          .gte('call_date', weekStart).lte('call_date', weekEnd)
          .order('call_date', { ascending: false }).range(f, t)
      );
      return {
        records: calls.map(c => ({
          id: c.id, primary: c.contact_name || 'Unknown', secondary: c.contact_phone ? String(c.contact_phone) : '',
          detail: c.outcome || '', date: c.call_date,
          badges: [c.outcome, c.attended ? 'Attended' : ''].filter(Boolean),
          extra: { outcome: c.outcome, notes: c.notes || null, attended: !!c.attended },
        })),
        volunteers: [],
      };
    }

    if (metric === '1-on-1s') {
      const logs = await fetchAllRows<any>(
        (f, t) => supabase.from('one_on_one_logs')
          .select('id,contact_name,contact_phone,log_date,conversation_quality,follow_up_required,shows_initiative,notes')
          .eq('logged_by_volunteer_id', volunteerId)
          .gte('log_date', weekStart).lte('log_date', weekEnd)
          .order('log_date', { ascending: false }).range(f, t)
      );
      return {
        records: logs.map(l => ({
          id: l.id, primary: l.contact_name || 'Unknown', secondary: l.contact_phone ? String(l.contact_phone) : '',
          detail: l.notes || '', date: l.log_date,
          badges: [l.conversation_quality, l.follow_up_required === 'Yes' ? 'Follow-up' : '', l.shows_initiative === 'Yes' ? 'Initiative' : ''].filter(Boolean),
          extra: { quality: l.conversation_quality, followUp: l.follow_up_required, initiative: l.shows_initiative, notes: l.notes || null },
        })),
        volunteers: [],
      };
    }

    if (metric === 'Attendance' || metric === 'New Leads') {
      // Get contacts brought by this volunteer
      const contacts = await fetchAllRows<any>(
        (f, t) => supabase.from('contacts')
          .select('contact_id,full_name,phone,age_bracket,gender,organisation_name')
          .eq('brought_by_volunteer_id', volunteerId).range(f, t)
      );
      const broughtContactIds = contacts.map(c => c.contact_id).filter(Boolean) as string[];
      if (!broughtContactIds.length) return { records: [], volunteers: [] };

      const contactMap = new Map(contacts.map(c => [c.contact_id, c]));

      const att = await fetchAllRows<any>(
        (f, t) => supabase.from('attendance_log')
          .select('id,contact_id,contact_name,contact_phone,session_date,organisation')
          .in('contact_id', broughtContactIds).eq('present', 'Yes')
          .gte('session_date', weekStart).lte('session_date', weekEnd)
          .order('session_date', { ascending: false }).range(f, t)
      );

      const visitCounts = await getAttendanceCountsForContacts(broughtContactIds);

      if (metric === 'New Leads') {
        // Find first-ever attendance
        const allAttEver = await fetchAllRows<any>(
          (f, t) => supabase.from('attendance_log').select('contact_id,session_date')
            .in('contact_id', broughtContactIds).eq('present', 'Yes')
            .order('session_date', { ascending: true }).range(f, t)
        );
        const firstDates = new Map<string, string>();
        for (const a of allAttEver) {
          if (a.contact_id && !firstDates.has(a.contact_id)) firstDates.set(a.contact_id, a.session_date);
        }
        const newLeadIds = new Set<string>();
        for (const [cid, fd] of firstDates) {
          if (fd >= weekStart && fd <= weekEnd) newLeadIds.add(cid);
        }
        const seen = new Set<string>();
        const filtered = att.filter(a => {
          if (!a.contact_id || !newLeadIds.has(a.contact_id) || seen.has(a.contact_id)) return false;
          seen.add(a.contact_id);
          return true;
        });
        return {
          records: filtered.map(a => {
            const cd = contactMap.get(a.contact_id);
            return {
              id: a.id, primary: a.contact_name || cd?.full_name || 'Unknown',
              secondary: a.contact_phone ? String(a.contact_phone) : cd?.phone ? String(cd.phone) : '',
              detail: cd?.organisation_name || a.organisation || '', date: a.session_date,
              badges: ['New Lead'],
              extra: { age: cd?.age_bracket || null, gender: cd?.gender || null, org: cd?.organisation_name || null, visits: visitCounts.get(a.contact_id) || 0 },
            };
          }),
          volunteers: [],
        };
      }

      // Attendance
      return {
        records: att.map(a => {
          const cd = contactMap.get(a.contact_id);
          return {
            id: a.id, primary: a.contact_name || cd?.full_name || 'Unknown',
            secondary: a.contact_phone ? String(a.contact_phone) : cd?.phone ? String(cd.phone) : '',
            detail: cd?.organisation_name || a.organisation || '', date: a.session_date,
            badges: [],
            extra: { age: cd?.age_bracket || null, gender: cd?.gender || null, org: cd?.organisation_name || null, visits: visitCounts.get(a.contact_id) || 0 },
          };
        }),
        volunteers: [],
      };
    }

    if (metric === 'Overnight Stays') {
      let stays: any[] = [];
      try {
        stays = await fetchAllRows<any>(
          (f, t) => supabase.from('overnight_stays').select('*')
            .range(f, t)
        );
      } catch { /* empty */ }
      return {
        records: stays.map(s => ({
          id: s.id, primary: s.contact_name || s.name || 'Unknown',
          secondary: s.contact_phone || s.phone || '', detail: '', date: s.stay_date || s.date || '',
          badges: [], extra: {},
        })),
        volunteers: [],
      };
    }

    return { records: [], volunteers: [] };
  },
});
