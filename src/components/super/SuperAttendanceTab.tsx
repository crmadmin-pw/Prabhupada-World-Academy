import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ClipboardCheck, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { getSuperGuideAttendanceReport } from 'zite-endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';
import { exportToCsv } from '@/utils/exportCsv';
import { fmt } from '@/lib/fmt';

export default function SuperAttendanceTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ashrayLevel, setAshrayLevel] = useState('');
  const [guideId, setGuideId] = useState('');
  const [residencyId, setResidencyId] = useState('');
  const [eventId, setEventId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSuperGuideAttendanceReport({
        startDate: startDate || undefined, endDate: endDate || undefined,
        ashrayLevel: ashrayLevel || undefined, guideId: guideId || undefined,
        residencyId: residencyId || undefined, eventId: eventId || undefined,
        sessionId: sessionId || undefined, search: search || undefined,
        offset, limit: LIMIT,
      });
      setData(res);
    } catch { /* silent */ }
    setLoading(false);
  }, [startDate, endDate, ashrayLevel, guideId, residencyId, eventId, sessionId, search, offset]);

  useEffect(() => { load(); }, [load]);

  const debouncedSearch = useDebouncedCallback((val: string) => { setSearch(val); setOffset(0); }, 400);

  const resetFilters = () => {
    setStartDate(''); setEndDate(''); setAshrayLevel(''); setGuideId(''); setResidencyId('');
    setEventId(''); setSessionId(''); setSearch(''); setOffset(0);
  };

  const filteredSessions = data?.filterOptions?.sessions?.filter((s: any) => !eventId || s.eventId === eventId) || [];

  const handleExport = () => {
    if (!data?.records) return;
    exportToCsv(data.records.map((r: any) => ({
      Name: r.name, Phone: r.phone, 'Ashray Level': r.ashrayLevel,
      Guide: r.guideName, Center: r.centerName, Session: r.sessionName,
      Event: r.eventTitle, Date: r.date, Source: r.source,
    })), 'super-attendance-report');
  };

  if (loading && !data) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>;

  const stats = data?.stats;
  const fo = data?.filterOptions;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-primary">{stats?.totalCheckins || 0}</p>
          <p className="text-xs text-muted-foreground">Total Check-ins</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <p className="text-2xl font-bold text-primary">{stats?.uniqueParticipants || 0}</p>
          <p className="text-xs text-muted-foreground">Unique Participants</p>
        </CardContent></Card>
      </div>

      {/* Level & Center breakdowns */}
      {(stats?.levelBreakdown?.length > 0 || stats?.centerBreakdown?.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {stats?.levelBreakdown?.map((lb: any) => (
            <Badge key={lb.level} variant="outline" className="text-xs gap-1">
              {lb.level} <span className="font-bold">{lb.count}</span>
            </Badge>
          ))}
          {stats?.centerBreakdown?.map((cb: any) => (
            <Badge key={cb.centerName} variant="secondary" className="text-xs gap-1">
              {cb.centerName} <span className="font-bold">{cb.count}</span>
            </Badge>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Name or phone" className="pl-8 h-9" onChange={e => debouncedSearch(e.target.value)} />
              </div>
            </div>
            <div className="min-w-[110px]">
              <label className="text-xs text-muted-foreground mb-1 block">From</label>
              <Input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setOffset(0); }} className="h-9" />
            </div>
            <div className="min-w-[110px]">
              <label className="text-xs text-muted-foreground mb-1 block">To</label>
              <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setOffset(0); }} className="h-9" />
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Guide</label>
              <Select value={guideId} onValueChange={v => { setGuideId(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guides</SelectItem>
                  {(fo?.guides || []).map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Center</label>
              <Select value={residencyId} onValueChange={v => { setResidencyId(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Centers</SelectItem>
                  {(fo?.centers || []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Level</label>
              <Select value={ashrayLevel} onValueChange={v => { setAshrayLevel(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Event</label>
              <Select value={eventId} onValueChange={v => { setEventId(v === 'all' ? '' : v); setSessionId(''); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  {(fo?.events || []).map((e: any) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[120px]">
              <label className="text-xs text-muted-foreground mb-1 block">Session</label>
              <Select value={sessionId} onValueChange={v => { setSessionId(v === 'all' ? '' : v); setOffset(0); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sessions</SelectItem>
                  {filteredSessions.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={resetFilters} className="h-9">Reset</Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="h-9 gap-1">
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="pt-4 p-0">
          {loading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !data?.records?.length ? (
            <div className="py-12 text-center text-muted-foreground">
              <ClipboardCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>No attendance records found</p>
            </div>
          ) : (
            <>
              <div className="block md:hidden divide-y">
                {data.records.map((r: any) => (
                  <div key={r.id} className="p-3 space-y-1">
                    <div className="flex justify-between items-start">
                      <p className="font-medium text-sm">{r.name}</p>
                      <Badge variant="outline" className="text-xs">{r.ashrayLevel}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.guideName} · {r.centerName}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{r.sessionName}</span><span>·</span><span>{fmt.date(r.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left p-3 font-medium">Name</th>
                    <th className="text-left p-3 font-medium">Phone</th>
                    <th className="text-left p-3 font-medium">Level</th>
                    <th className="text-left p-3 font-medium">Guide</th>
                    <th className="text-left p-3 font-medium">Center</th>
                    <th className="text-left p-3 font-medium">Session</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Source</th>
                  </tr></thead>
                  <tbody>
                    {data.records.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30">
                        <td className="p-3 font-medium">{r.name}</td>
                        <td className="p-3 text-muted-foreground">{r.phone}</td>
                        <td className="p-3"><Badge variant="outline" className="text-xs">{r.ashrayLevel}</Badge></td>
                        <td className="p-3">{r.guideName}</td>
                        <td className="p-3">{r.centerName}</td>
                        <td className="p-3">{r.sessionName}</td>
                        <td className="p-3">{fmt.date(r.date)}</td>
                        <td className="p-3"><Badge variant="secondary" className="text-xs">{r.source}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between p-3 border-t">
                <p className="text-xs text-muted-foreground">
                  Showing {offset + 1}–{Math.min(offset + LIMIT, data.pagination.totalCount)} of {data.pagination.totalCount}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                    <ChevronLeft className="w-4 h-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" disabled={!data.pagination.hasMore} onClick={() => setOffset(offset + LIMIT)}>
                    Next <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
