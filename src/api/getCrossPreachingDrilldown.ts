import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';
import { supabase, fetchAllRows } from '../utils/supabase';
import { requireGuideRole } from '../lib/userUtils';

const TARGET_SLUGS = ['powai', 'vashi', 'sion', 'airoli', 'thane'];

async function resolveEffectiveCenterIds(centerId: string): Promise<string[]> {
  if (centerId !== 'TOTAL') return [centerId];
  const { data } = await supabase.from('centers').select('id,slug').in('slug', TARGET_SLUGS);
  return (data || []).map((c: any) => c.id);
}

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

async function getContactDetails(contactIds: string[]): Promise<Map<string, any>> {
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
  description: 'Drill-down for cross-center preaching report — returns actual records behind a number',
  authenticated: true,
  inputSchema: z.object({
    metric: z.string(),
    centerId: z.string(),
    weekStart: z.string(),
    weekEnd: z.string(),
  }),
  outputSchema: z.any(),
  execute: async ({ input, context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    requireGuideRole(context.user.role, { isSadhanaMentor: context.user.isSadhanaMentor, isBvsl: context.user.isBvsl });

    const { metric, centerId, weekStart, weekEnd } = input;

    const isMock = !process.env.ZITE_SUPABASE_URL || process.env.ZITE_SUPABASE_URL.includes('mockproject');

    if (isMock) {
      const mockContactNames = ['Rohit Sharma', 'Virat Kohli', 'K. L. Rahul', 'Jasprit Bumrah', 'R. Jadeja', 'Hardik Pandya', 'Rishabh Pant', 'Shubman Gill', 'Y. Jaiswal', 'Suryakumar Yadav', 'Axar Patel', 'Kuldeep Yadav', 'Mohammed Siraj', 'Shreyas Iyer', 'Mohammed Shami'];
      const mockBooks = ['Bhagavad Gita As It Is', 'Science of Self Realization', 'Krsna, The Supreme Personality of Godhead', 'Nectar of Instruction', 'Perfect Questions, Perfect Answers', 'Easy Journey to Other Planets'];

      if (metric === 'Books Distributed') {
        const records = Array.from({ length: 8 }).map((_, i) => ({
          id: `book_${i}`,
          primary: `Volunteer Dasa ${i + 1}`,
          secondary: mockBooks[i % mockBooks.length],
          detail: `Qty: ${Math.floor(Math.random() * 20) + 5} · ${(i + 1) * 10} pts`,
          date: weekStart,
          badges: ['Preaching Campaign', 'West Zone'],
          extra: {
            contactName: `Devotee ${i}`,
            quantity: Math.floor(Math.random() * 20) + 5,
            points: (i + 1) * 10,
          },
        }));
        return { records };
      }

      if (metric === 'Offline Attendance') {
        const records = Array.from({ length: 12 }).map((_, i) => ({
          id: `att_${i}`,
          primary: mockContactNames[i % mockContactNames.length],
          secondary: `9190909090${String(i).padStart(2, '0')}`,
          detail: 'IIT Bombay / TCS',
          date: weekStart,
          badges: [`Invited by: Volunteer ${i}`],
          extra: {
            age: '20-25',
            gender: 'Male',
            org: 'IIT Bombay',
            visits: i + 1,
            broughtBy: `Volunteer ${i}`,
            source: 'Campus Outreach',
          },
        }));
        return { records };
      }

      if (metric === 'New Leads') {
        const records = Array.from({ length: 6 }).map((_, i) => ({
          id: `lead_${i}`,
          primary: mockContactNames[(i + 5) % mockContactNames.length],
          secondary: `9191919191${String(i).padStart(2, '0')}`,
          detail: 'VJTI College / Infy',
          date: weekStart,
          badges: ['New Lead'],
          extra: {
            age: '18-22',
            gender: 'Male',
            org: 'VJTI College',
            source: 'Maha Festival',
            broughtBy: `Volunteer ${i}`,
            status: 'Hot Lead',
          },
        }));
        return { records };
      }

      if (metric === 'Unique 1-on-1s') {
        const records = Array.from({ length: 7 }).map((_, i) => ({
          id: `o2o_${i}`,
          primary: mockContactNames[(i + 8) % mockContactNames.length],
          secondary: `9192929292${String(i).padStart(2, '0')}`,
          detail: 'By: Sameer Dasa',
          date: weekStart,
          badges: ['Excellent Japa', 'Follow-up Scheduled', 'Shows Initiative'],
          extra: {
            quality: 'Excellent',
            followUp: 'Yes',
            initiative: 'Yes',
            notes: 'Very positive response, wants to join resident template.',
          },
        }));
        return { records };
      }

      if (metric === 'Overnight Stays') {
        const records = Array.from({ length: 4 }).map((_, i) => ({
          id: `stay_${i}`,
          primary: mockContactNames[(i + 3) % mockContactNames.length],
          secondary: `9193939393${String(i).padStart(2, '0')}`,
          detail: `Hostel Room ${101 + i}`,
          date: weekStart,
          badges: [],
          extra: {},
        }));
        return { records };
      }
    }

    const effectiveCenterIds = await resolveEffectiveCenterIds(centerId);

    // ── Books Distributed ──
    if (metric === 'Books Distributed') {
      const books = await fetchAllRows<any>(
        (f, t) => supabase.from('book_distribution_log')
          .select('id,volunteer_name,book_name,quantity,calculated_book_points,date_of_distribution,team_name,source,contact_name')
          .in('center_id', effectiveCenterIds)
          .gte('date_of_distribution', weekStart).lte('date_of_distribution', weekEnd)
          .order('date_of_distribution', { ascending: false }).range(f, t)
      );
      return {
        records: books.map((b: any) => ({
          id: b.id,
          primary: b.volunteer_name || 'Unknown',
          secondary: b.book_name || '',
          detail: `Qty: ${b.quantity || 0} · ${b.calculated_book_points ?? 0} pts`,
          date: b.date_of_distribution,
          badges: [b.source, b.team_name].filter(Boolean),
          extra: {
            contactName: b.contact_name || null,
            quantity: b.quantity,
            points: b.calculated_book_points,
          },
        })),
      };
    }

    // ── Offline Attendance ──
    if (metric === 'Offline Attendance') {
      const volunteers = await fetchAllRows<any>(
        (f, t) => supabase.from('volunteers').select('phone').in('center_id', effectiveCenterIds).range(f, t)
      );
      const volPhones = new Set(volunteers.filter((v: any) => v.phone).map((v: any) => String(v.phone)));
      const dncContacts = await fetchAllRows<any>(
        (f, t) => supabase.from('contacts').select('contact_id').eq('call_eligible', 'No').in('center_id', effectiveCenterIds).range(f, t)
      );
      const dncSet = new Set(dncContacts.map((c: any) => c.contact_id));

      const att = await fetchAllRows<any>(
        (f, t) => supabase.from('attendance_log')
          .select('id,contact_name,contact_phone,contact_id,session_date,organisation,volunteer_name')
          .in('center_id', effectiveCenterIds).eq('present', 'Yes')
          .gte('session_date', weekStart).lte('session_date', weekEnd)
          .order('session_date', { ascending: false }).range(f, t)
      );
      const filtered = att.filter((a: any) => {
        if (a.contact_id && dncSet.has(a.contact_id)) return false;
        if (a.contact_phone && volPhones.has(String(a.contact_phone))) return false;
        return true;
      });

      // Enrich with contact details + visit counts
      const cids = [...new Set(filtered.map((a: any) => a.contact_id).filter(Boolean))] as string[];
      const [contactDetails, visitCounts] = await Promise.all([
        getContactDetails(cids),
        getAttendanceCountsForContacts(cids),
      ]);

      return {
        records: filtered.map((a: any) => {
          const cd = a.contact_id ? contactDetails.get(a.contact_id) : null;
          const visits = a.contact_id ? visitCounts.get(a.contact_id) || 0 : 0;
          return {
            id: a.id,
            primary: a.contact_name || 'Unknown',
            secondary: a.contact_phone ? String(a.contact_phone) : '',
            detail: a.organisation || cd?.organisation_name || '',
            date: a.session_date,
            badges: [a.volunteer_name ? `By: ${a.volunteer_name}` : ''].filter(Boolean),
            extra: {
              age: cd?.age_bracket || null,
              gender: cd?.gender || null,
              org: a.organisation || cd?.organisation_name || null,
              visits,
              broughtBy: cd?.brought_by_volunteer_name || a.volunteer_name || null,
              source: cd?.source || null,
            },
          };
        }),
      };
    }

    // ── New Leads ──
    if (metric === 'New Leads') {
      const att = await fetchAllRows<any>(
        (f, t) => supabase.from('attendance_log')
          .select('contact_id,contact_name,contact_phone,session_date,center_id,organisation')
          .in('center_id', effectiveCenterIds).eq('present', 'Yes')
          .gte('session_date', weekStart).lte('session_date', weekEnd).range(f, t)
      );
      const contactIds = [...new Set(att.map((a: any) => a.contact_id).filter(Boolean))] as string[];
      if (!contactIds.length) return { records: [] };

      // Find first-ever attendance for each contact
      const allAtt = await fetchAllRows<any>(
        (f, t) => supabase.from('attendance_log').select('contact_id,session_date')
          .in('contact_id', contactIds).eq('present', 'Yes')
          .order('session_date', { ascending: true }).range(f, t)
      );
      const firstDates = new Map<string, string>();
      for (const a of allAtt) {
        if (a.contact_id && !firstDates.has(a.contact_id)) firstDates.set(a.contact_id, a.session_date);
      }
      const newLeadIds = new Set<string>();
      for (const [cid, firstDate] of firstDates) {
        if (firstDate >= weekStart && firstDate <= weekEnd) newLeadIds.add(cid);
      }

      // Deduplicate
      const seen = new Set<string>();
      const deduped = att.filter((a: any) => {
        if (!a.contact_id || !newLeadIds.has(a.contact_id) || seen.has(a.contact_id)) return false;
        seen.add(a.contact_id);
        return true;
      });

      // Enrich with contact details
      const newLeadCids = deduped.map((a: any) => a.contact_id).filter(Boolean) as string[];
      const contactDetails = await getContactDetails(newLeadCids);

      return {
        records: deduped.map((a: any) => {
          const cd = a.contact_id ? contactDetails.get(a.contact_id) : null;
          return {
            id: a.contact_id,
            primary: a.contact_name || cd?.full_name || 'Unknown',
            secondary: a.contact_phone ? String(a.contact_phone) : '',
            detail: cd?.organisation_name || a.organisation || '',
            date: a.session_date,
            badges: ['New Lead'],
            extra: {
              age: cd?.age_bracket || null,
              gender: cd?.gender || null,
              org: cd?.organisation_name || a.organisation || null,
              source: cd?.source || null,
              broughtBy: cd?.brought_by_volunteer_name || null,
              status: cd?.status || null,
            },
          };
        }),
      };
    }

    // ── Unique 1-on-1s ──
    if (metric === 'Unique 1-on-1s') {
      const logs = await fetchAllRows<any>(
        (f, t) => supabase.from('one_on_one_logs')
          .select('id,contact_id,contact_name,contact_phone,log_date,logged_by_name,conversation_quality,follow_up_required,shows_initiative,notes')
          .in('center_id', effectiveCenterIds)
          .gte('log_date', weekStart).lte('log_date', weekEnd)
          .order('log_date', { ascending: false }).range(f, t)
      );
      const seen = new Set<string>();
      const deduped = logs.filter((l: any) => {
        if (!l.contact_id || seen.has(l.contact_id)) return false;
        seen.add(l.contact_id);
        return true;
      });
      return {
        records: deduped.map((l: any) => ({
          id: l.id,
          primary: l.contact_name || 'Unknown',
          secondary: l.contact_phone ? String(l.contact_phone) : '',
          detail: `By: ${l.logged_by_name || '?'}`,
          date: l.log_date,
          badges: [l.conversation_quality, l.follow_up_required === 'Yes' ? 'Follow-up' : '', l.shows_initiative === 'Yes' ? 'Initiative' : ''].filter(Boolean),
          extra: {
            quality: l.conversation_quality || null,
            followUp: l.follow_up_required || null,
            initiative: l.shows_initiative || null,
            notes: l.notes || null,
          },
        })),
      };
    }

    // ── Overnight Stays ──
    if (metric === 'Overnight Stays') {
      let stays: any[] = [];
      try {
        stays = await fetchAllRows<any>(
          (f, t) => supabase.from('overnight_stays').select('*')
            .in('center_id', effectiveCenterIds).range(f, t)
        );
      } catch { /* empty table */ }
      return {
        records: stays.map((s: any) => ({
          id: s.id,
          primary: s.contact_name || s.name || 'Unknown',
          secondary: s.contact_phone || s.phone || '',
          detail: s.volunteer_name || '',
          date: s.stay_date || s.date || '',
          badges: [],
          extra: {},
        })),
      };
    }

    return { records: [] };
  },
});
