import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { getBvAdminTable } from 'zite-endpoints-sdk';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';

interface Row {
  userId: string;
  name: string;
  ashrayLevel: string | null;
  groupName: string;
  bvslName: string;
  isResident: boolean;
  residencyName: string;
  guideName: string;
  attendance: Record<string, number>;
  weekTotal: number;
}

interface Props {
  groupId?: string;
  bvslId?: string;
  guideId?: string;
}

type WeekFilter = 'this_week' | 'prev_week' | 'custom';

function getWeekRange(type: 'this_week' | 'prev_week'): { start: string; end: string } {
  const today = new Date();
  const base = type === 'prev_week' ? subWeeks(today, 1) : today;
  const mon = startOfWeek(base, { weekStartsOn: 1 });
  const sun = endOfWeek(base, { weekStartsOn: 1 });
  return {
    start: format(mon, 'yyyy-MM-dd'),
    end: format(sun, 'yyyy-MM-dd'),
  };
}

export default function BvAdminDataTable({ groupId, bvslId, guideId }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [weekFilter, setWeekFilter] = useState<WeekFilter>('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { start, end } = useMemo(() => {
    if (weekFilter === 'custom' && customStart && customEnd) return { start: customStart, end: customEnd };
    return getWeekRange(weekFilter === 'prev_week' ? 'prev_week' : 'this_week');
  }, [weekFilter, customStart, customEnd]);

  useEffect(() => { loadData(); }, [guideId, groupId, start, end]);

  const loadData = async () => {
    if (!start || !end) return;
    setLoading(true);
    try {
      const res = await getBvAdminTable({
        guideId: guideId || undefined,
        startDate: start,
        endDate: end,
      });
      setRows((res as any).rows || []);
      setDates((res as any).dates || []);
    } catch { toast.error('Failed to load attendance data'); }
    finally { setLoading(false); }
  };

  const filteredRows = rows.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.groupName.toLowerCase().includes(search.toLowerCase())
  );

  const exportCsv = () => {
    const dateHeaders = dates.map(d => format(new Date(d + 'T00:00:00'), 'd MMM yy'));
    const headers = ['Full Name', 'Group', 'BVSL', 'Level (Ashraya)', 'Resident', ...dateHeaders, 'Week Total'];
    const csvRows = filteredRows.map(r => [
      r.name,
      r.groupName,
      r.bvslName,
      r.ashrayLevel || '',
      r.isResident ? 'Yes' : 'No',
      ...dates.map(d => r.attendance[d] ?? 0),
      r.weekTotal,
    ]);
    const csv = [headers, ...csvRows].map(row =>
      row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bv_attendance_${start}_to_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported!');
  };

  const totalPresent = filteredRows.reduce((sum, r) => sum + r.weekTotal, 0);

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold">{filteredRows.length}</div>
          <div className="text-xs text-muted-foreground">Members</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-green-600">{totalPresent}</div>
          <div className="text-xs text-muted-foreground">Present Sessions</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold">{dates.length}</div>
          <div className="text-xs text-muted-foreground">Days in Range</div>
        </CardContent></Card>
      </div>

      {/* Date Filter Buttons */}
      <div className="flex flex-wrap gap-2">
        {(['this_week', 'prev_week', 'custom'] as WeekFilter[]).map(f => (
          <Button
            key={f}
            size="sm"
            variant={weekFilter === f ? 'default' : 'outline'}
            onClick={() => setWeekFilter(f)}
          >
            {f === 'this_week' ? 'This Week' : f === 'prev_week' ? 'Previous Week' : 'Custom Range'}
          </Button>
        ))}
      </div>

      {/* Custom Range Inputs */}
      {weekFilter === 'custom' && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">From</span>
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">To</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36" />
          </div>
        </div>
      )}

      {/* Search + Export */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, group..." className="pl-8" />
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={loading || rows.length === 0}>
          <Download className="w-4 h-4 mr-1" />Export CSV
        </Button>
      </div>

      {/* Matrix Table */}
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          {loading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : filteredRows.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No members found for this period</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">Full Name</th>
                  <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">Group</th>
                  <th className="text-left py-2 pr-3 font-medium whitespace-nowrap">Level</th>
                  {dates.map(d => (
                    <th key={d} className="text-center py-2 px-1 font-medium whitespace-nowrap text-xs">
                      {format(new Date(d + 'T00:00:00'), 'd MMM')}
                    </th>
                  ))}
                  <th className="text-center py-2 pl-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => (
                  <tr key={r.userId + i} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.name || '—'}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{r.groupName || '—'}</td>
                    <td className="py-2 pr-3 text-muted-foreground text-xs">{r.ashrayLevel || '—'}</td>
                    {dates.map(d => {
                      const val = r.attendance[d] ?? 0;
                      return (
                        <td key={d} className="py-2 px-1 text-center">
                          <span className={`font-bold ${val === 1 ? 'text-green-600' : 'text-muted-foreground/40'}`}>{val === 1 ? '✓' : '·'}</span>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-2 text-center font-bold text-primary">{r.weekTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
