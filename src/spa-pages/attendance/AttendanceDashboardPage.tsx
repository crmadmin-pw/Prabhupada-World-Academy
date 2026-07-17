import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAttendanceDashboard } from 'zite-endpoints-sdk';
import type { GetAttendanceDashboardOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ArrowLeft, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { format } from 'date-fns';
import { useDebouncedCallback } from 'use-debounce';

type DashRecord = GetAttendanceDashboardOutputType['records'][0];
type EventOption = GetAttendanceDashboardOutputType['events'][0];
type SessionOption = GetAttendanceDashboardOutputType['sessions'][0];

const PAGE_SIZE = 25;

export default function AttendanceDashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DashRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [uniqueParticipants, setUniqueParticipants] = useState(0);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [hasMore, setHasMore] = useState(false);

  const [eventId, setEventId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);

  const fetch = useCallback(async (o: number) => {
    setLoading(true);
    try {
      const res = await getAttendanceDashboard({
        eventId: eventId || undefined,
        sessionId: sessionId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
        offset: o,
        limit: PAGE_SIZE,
      });
      setRecords(res.records);
      setTotalCount(res.totalCount);
      setUniqueParticipants(res.uniqueParticipants);
      setEvents(res.events);
      setSessions(res.sessions);
      setHasMore(res.hasMore);
      setOffset(o);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load');
    }
    setLoading(false);
  }, [eventId, sessionId, startDate, endDate, search]);

  useEffect(() => { fetch(0); }, [fetch]);

  const debouncedSetSearch = useDebouncedCallback((v: string) => setSearch(v), 400);

  const filteredSessions = eventId ? sessions.filter(s => s.eventId === eventId) : sessions;

  const exportCsv = () => {
    if (records.length === 0) { toast.error('No data to export'); return; }
    const headers = ['Name', 'Phone', 'Session', 'Date', 'Source'];
    const rows = records.map(r => [r.name, r.phone, r.sessionName, r.date, r.source]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded!');
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
            <h1 className="text-lg font-bold">Attendance Dashboard</h1>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> Export CSV</Button>
        </div>
      </header>

      {/* Filters */}
      <div className="container mx-auto px-4 py-4 flex flex-wrap gap-3">
        <select
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
          value={eventId}
          onChange={e => { setEventId(e.target.value); setSessionId(''); }}
        >
          <option value="">All Events</option>
          {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <select
          className="border border-border rounded-md px-3 py-1.5 text-sm bg-background"
          value={sessionId}
          onChange={e => setSessionId(e.target.value)}
        >
          <option value="">All Sessions</option>
          {filteredSessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Input type="date" className="w-36" value={startDate} onChange={e => setStartDate(e.target.value)} />
        <Input type="date" className="w-36" value={endDate} onChange={e => setEndDate(e.target.value)} />
        <div className="relative w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search name or phone…" className="pl-9" onChange={e => debouncedSetSearch(e.target.value)} />
        </div>
      </div>

      {/* Stats */}
      <div className="container mx-auto px-4 py-2">
        <div className="grid grid-cols-3 gap-4">
          <StatCard value={uniqueParticipants} label="Unique Participants" loading={loading} />
          <StatCard value={totalCount} label="Total Check-ins" loading={loading} />
          <StatCard value={sessions.length > 0 ? Math.round(totalCount / sessions.length) : 0} label="Avg per Session" loading={loading} />
        </div>
      </div>

      {/* Table */}
      <div className="container mx-auto px-4 py-4">
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border text-left">
                  <th className="py-2.5 px-4 font-medium text-muted-foreground">Name</th>
                  <th className="py-2.5 px-4 font-medium text-muted-foreground">Phone</th>
                  <th className="py-2.5 px-4 font-medium text-muted-foreground">Session</th>
                  <th className="py-2.5 px-4 font-medium text-muted-foreground">Date</th>
                  <th className="py-2.5 px-4 font-medium text-muted-foreground">Source</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 5 }).map((_, j) => <td key={j} className="py-2.5 px-4"><Skeleton className="h-4 w-24" /></td>)}
                  </tr>
                ))}
                {!loading && records.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No attendance records found</td></tr>
                )}
                {!loading && records.map(r => (
                  <tr key={r.id} className="border-b border-border hover:bg-muted/20">
                    <td className="py-2.5 px-4 font-medium">{r.name}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{r.phone}</td>
                    <td className="py-2.5 px-4">{r.sessionName}</td>
                    <td className="py-2.5 px-4">{r.date ? format(new Date(r.date + 'T00:00:00'), 'MMM d, yyyy') : ''}</td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.source === 'Registered User' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                        {r.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-muted-foreground">
            Showing {totalCount === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, totalCount)} of {totalCount}
          </p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => fetch(Math.max(0, offset - PAGE_SIZE))}>
              <ChevronLeft className="w-4 h-4" /> Prev
            </Button>
            <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => fetch(offset + PAGE_SIZE)}>
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label, loading }: { value: number; label: string; loading: boolean }) {
  return (
    <div className="border border-border rounded-lg p-4 text-center bg-card">
      {loading ? <Skeleton className="h-8 w-16 mx-auto" /> : <p className="text-2xl font-bold text-foreground">{value}</p>}
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
