import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, Users, TrendingUp, RefreshCw, FileDown, Image, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getBvSessionReport } from 'zite-endpoints-sdk';
import type { GetBvSessionReportOutputType } from 'zite-endpoints-sdk';
import { useDebouncedCallback } from 'use-debounce';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { EmptyState } from '@/shared';
import { exportToCsv } from '@/utils/exportCsv';

interface Props { guideId: string; }

export default function BvSessionReportTab({ guideId }: Props) {
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [groupFilter, setGroupFilter] = useState('all');
  const [data, setData] = useState<GetBvSessionReportOutputType | null>(null);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBvSessionReport({
        guideId, startDate, endDate,
        groupId: groupFilter !== 'all' ? groupFilter : undefined,
      });
      setData(result);
    } catch { toast.error('Failed to load session report'); }
    finally { setLoading(false); }
  }, [guideId, startDate, endDate, groupFilter]);

  const debouncedFetch = useDebouncedCallback(fetchReport, 300);
  useEffect(() => { debouncedFetch(); }, [guideId, startDate, endDate, groupFilter]);

  const sessions = useMemo(() => data?.sessions || [], [data]);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Date', 'Group', 'BVSL', 'Topic', 'Attendees', 'Total', 'Attendance %'];
    const rows = sessions.map(s => [
      s.sessionDate ? format(new Date(s.sessionDate + 'T00:00:00'), 'yyyy-MM-dd') : '',
      s.groupName, s.bvslName, s.topic || '', s.presentCount, s.totalMembers, `${s.attendancePercent}%`,
    ]);
    exportToCsv(`bv-sessions-${startDate}-${endDate}.csv`, headers, rows);
  };

  const handleWhatsAppReminder = () => {
    if (!sessions.length) return;
    const groupNames = [...new Set(sessions.map(s => s.groupName))];
    const msg = `🙏 Hare Krishna!\n\nBV Session Report (${startDate} to ${endDate}):\n• ${sessions.length} sessions conducted\n• Groups: ${groupNames.join(', ')}\n• Avg Attendance: ${sessions.length > 0 ? Math.round(sessions.reduce((s, r) => s + r.attendancePercent, 0) / sessions.length) : 0}%`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };
  const groups = useMemo(() => data?.groups || [], [data]);

  const summary = useMemo(() => {
    const total = sessions.length;
    const avgAtt = total > 0 ? Math.round(sessions.reduce((s, r) => s + r.attendancePercent, 0) / total) : 0;
    const uniqueParticipants = new Set<string>();
    // Can't compute unique participants without user-level data, use presentCount sum
    const totalPresent = sessions.reduce((s, r) => s + r.presentCount, 0);
    return { total, avgAtt, totalPresent };
  }, [sessions]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">BV Session Report</CardTitle>
              <button onClick={fetchReport} disabled={loading} title="Refresh"
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 text-xs font-medium">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Button size="sm" variant="outline" className="h-8" onClick={handleExportCsv} disabled={!data || loading}>
                <FileDown className="w-3 h-3 mr-1" />Export CSV
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-green-600 text-green-700 hover:bg-green-600 hover:text-white" onClick={handleWhatsAppReminder} disabled={!data || loading}>
                <MessageCircle className="w-3 h-3 mr-1" />WhatsApp Group Reminder
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">From:</Label>
              <Input type="date" className="h-8 w-[140px]" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">To:</Label>
              <Input type="date" className="h-8 w-[140px]" value={endDate} onChange={e => setEndDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">Group:</Label>
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Groups</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd')); setEndDate(format(new Date(), 'yyyy-MM-dd')); }}>This Month</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setStartDate(format(subDays(new Date(), 30), 'yyyy-MM-dd')); setEndDate(format(new Date(), 'yyyy-MM-dd')); }}>Last 30 Days</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!data && loading && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Card><CardContent className="p-4"><Skeleton className="h-64" /></CardContent></Card>
        </div>
      )}

      {data && (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex flex-wrap gap-3">
            <Card className="flex-1 min-w-[110px]">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Total Sessions</span></div>
                <div className="text-2xl font-bold mt-1 text-primary">{summary.total}</div>
              </CardContent>
            </Card>
            <Card className="flex-1 min-w-[110px]">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Avg Attendance</span></div>
                <div className="text-2xl font-bold mt-1 text-primary">{summary.avgAtt}%</div>
              </CardContent>
            </Card>
            <Card className="flex-1 min-w-[110px]">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Total Attendees</span></div>
                <div className="text-2xl font-bold mt-1 text-primary">{summary.totalPresent}</div>
              </CardContent>
            </Card>
          </div>

          {sessions.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Date</th>
                        <th className="p-2 text-left font-medium">Group</th>
                        <th className="p-2 text-left font-medium">BVSL</th>
                        <th className="p-2 text-left font-medium">Topic</th>
                        <th className="p-2 text-right font-medium">Attendees</th>
                        <th className="p-2 text-right font-medium">Total</th>
                        <th className="p-2 text-right font-medium">Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map(s => {
                        const rateColor = s.attendancePercent >= 75 ? 'text-green-600' : s.attendancePercent >= 50 ? 'text-amber-600' : 'text-red-500';
                        return (
                          <tr key={s.sessionId} className="border-b hover:bg-muted/30">
                            <td className="p-2 whitespace-nowrap">{s.sessionDate ? format(new Date(s.sessionDate + 'T00:00:00'), 'MMM d, yyyy') : '—'}</td>
                            <td className="p-2">{s.groupName}</td>
                            <td className="p-2 text-muted-foreground">{s.bvslName}</td>
                            <td className="p-2 text-muted-foreground max-w-[200px] truncate">{s.topic || '—'}</td>
                            <td className="p-2 text-right font-medium">{s.presentCount}</td>
                            <td className="p-2 text-right text-muted-foreground">{s.totalMembers}</td>
                            <td className="p-2 text-right">
                              <Badge variant="outline" className={`${rateColor} border-current`}>{s.attendancePercent}%</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card><CardContent className="py-2"><EmptyState title="No sessions found in this date range." /></CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}
