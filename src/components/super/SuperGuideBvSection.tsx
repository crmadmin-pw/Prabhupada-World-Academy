import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCheck, Trophy, Users, TrendingUp, Wrench, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSuperGuideBvStats } from 'zite-endpoints-sdk';
import type { GetSuperGuideBvStatsOutputType } from 'zite-endpoints-sdk';
import { subWeeks } from 'date-fns';

function getISOWeek(date: Date): { weekNum: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { weekNum: Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7), year: d.getUTCFullYear() };
}

const RANK_STYLES = ['bg-yellow-100 text-yellow-700 border-yellow-300', 'bg-gray-100 text-gray-600 border-gray-300', 'bg-orange-100 text-orange-600 border-orange-300'];

export default function SuperGuideBvSection() {
  // Bug 11 fix: compute week options inside component so they're fresh on each render
  const weekOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const { weekNum, year } = getISOWeek(subWeeks(new Date(), i));
    return { value: `${year}-${weekNum}`, label: `Week ${weekNum}, ${year}${i === 0 ? ' (Current)' : ''}`, weekNum, year };
  }), []);

  const [loading, setLoading] = useState(true);
  const [filterGuideId, setFilterGuideId] = useState('');
  const [selectedWeek, setSelectedWeek] = useState(() => weekOptions[0].value);
  const [data, setData] = useState<GetSuperGuideBvStatsOutputType | null>(null);

  useEffect(() => { loadData(); }, [filterGuideId, selectedWeek]);

  const loadData = async () => {
    setLoading(true);
    try {
      const opt = weekOptions.find(o => o.value === selectedWeek) ?? weekOptions[0];
      const result = await getSuperGuideBvStats({ filterGuideId: filterGuideId || undefined, weekNumber: opt.weekNum, year: opt.year });
      setData(result);
    } catch { toast.error('Failed to load BV stats'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 mt-8">
      <div className="flex items-center gap-2 border-b pb-3">
        <CalendarCheck className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-bold">BhaktiVriksha Overview</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm shrink-0">Guide:</Label>
          <Select value={filterGuideId || 'all'} onValueChange={v => setFilterGuideId(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Guides</SelectItem>
              {data?.guides.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm shrink-0">Week:</Label>
          <Select value={selectedWeek} onValueChange={setSelectedWeek}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>{weekOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2 mb-1"><Users className="w-4 h-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Total Users</span></div><div className="text-2xl font-bold">{data.summary.totalUsers}</div><div className="text-xs text-muted-foreground">{data.summary.markedCount} marked ({data.summary.totalUsers > 0 ? Math.round(data.summary.markedCount / data.summary.totalUsers * 100) : 0}%)</div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4 text-green-600" /><span className="text-xs text-muted-foreground">Present</span></div><div className="text-2xl font-bold text-green-600">{data.summary.presentCount}</div><div className="text-xs text-muted-foreground">{data.summary.absentCount} absent · {data.summary.notMarkedCount} not marked</div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2 mb-1"><Wrench className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground">Full Service</span></div><div className="text-2xl font-bold text-primary">{data.summary.serviceFullCount}</div><div className="text-xs text-muted-foreground">of {data.summary.totalUsers} users</div></CardContent></Card>
            <Card><CardContent className="pt-4 pb-3"><div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-yellow-500" /><span className="text-xs text-muted-foreground">Avg Points</span></div><div className="text-2xl font-bold">{data.summary.avgPoints}<span className="text-sm font-normal text-muted-foreground">/3</span></div></CardContent></Card>
          </div>

          {/* Per-Guide Breakdown */}
          {!filterGuideId && data.guideBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Guide-wise Breakdown</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Guide</TableHead><TableHead className="text-center">Users</TableHead><TableHead className="text-center">Present</TableHead><TableHead className="text-center">Full Service</TableHead><TableHead className="text-center">Avg Points</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.guideBreakdown.map(g => (
                      <TableRow key={g.guideId}>
                        <TableCell className="font-medium">{g.guideName}</TableCell>
                        <TableCell className="text-center">{g.totalUsers}</TableCell>
                        <TableCell className="text-center"><span className="text-green-600 font-medium">{g.presentCount}</span><span className="text-xs text-muted-foreground ml-1">({g.totalUsers > 0 ? Math.round(g.presentCount / g.totalUsers * 100) : 0}%)</span></TableCell>
                        <TableCell className="text-center">{g.serviceFullCount}</TableCell>
                        <TableCell className="text-center"><Badge variant={g.avgPoints >= 2 ? 'default' : g.avgPoints >= 1 ? 'secondary' : 'outline'}>{g.avgPoints}/3</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Global Leaderboard */}
          <Card>
            <CardHeader className="pb-3"><div className="flex items-center gap-2"><Trophy className="w-5 h-5 text-yellow-500" /><CardTitle className="text-base">Global BV Leaderboard</CardTitle></div><p className="text-xs text-muted-foreground">All-time total points (attendance + service)</p></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {data.leaderboard.map((entry, idx) => (
                  <div key={entry.userId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${idx < 3 ? RANK_STYLES[idx] : 'bg-muted text-muted-foreground border-border'}`}>{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{entry.displayName}</div>
                      <div className="text-xs text-muted-foreground truncate">Guide: {entry.guideName} · {entry.ashrayLevel}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-green-600">{entry.totalPoints} pts</div>
                      <div className="text-[10px] text-muted-foreground">{entry.attendanceRate}% attend</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
