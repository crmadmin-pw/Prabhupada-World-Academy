/**
 * BvReportTab — color-coded BV preaching report (BVSL Report), mirrors SadhanaDetailTable style.
 * Duration thresholds: green ≥30 min, amber 15-29 min, red <15 min
 * Count thresholds:    green ≥2, amber =1, red =0
 * Total thresholds:    green ≥120 min, amber 60-119 min, red <60 min
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileDown, Users, Clock, Package, Phone, UserCheck, Search, RefreshCw, MessageCircle, Image } from 'lucide-react';
import { toast } from 'sonner';
import { getBvPreachingReport } from 'zite-endpoints-sdk';
import type { GetBvPreachingReportOutputType } from 'zite-endpoints-sdk';
import { useDebouncedCallback } from 'use-debounce';
import { format, subDays, startOfMonth, endOfMonth, startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear } from 'date-fns';
import { EmptyState } from '@/shared';
import { exportToCsv } from '@/utils/exportCsv';
import { exportBvslReportAsImage } from '@/utils/exportBvReportImage';

type ReportType = 'daily' | 'weekly' | 'monthly';
type BvslRow = GetBvPreachingReportOutputType['bvsls'][0];

export function minutesToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function durColor(mins: number): string {
  if (mins >= 30) return 'text-green-700 bg-green-50';
  if (mins >= 15) return 'text-amber-700 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

function countColor(n: number): string {
  if (n >= 2) return 'text-green-700 bg-green-50';
  if (n === 1) return 'text-amber-700 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

function totalColor(mins: number): string {
  if (mins >= 120) return 'text-green-700 font-bold';
  if (mins >= 60)  return 'text-amber-700 font-bold';
  return 'text-red-600 font-bold';
}

function getDefaultWeek(): string {
  const today = new Date();
  return `${getISOWeekYear(today)}-W${String(getISOWeek(today)).padStart(2, '0')}`;
}

function parseWeekInput(weekStr: string): { start: string; end: string } {
  const [yearStr, wStr] = weekStr.split('-W');
  const year = parseInt(yearStr); const week = parseInt(wStr);
  const jan4 = new Date(year, 0, 4);
  const ws = startOfISOWeek(jan4);
  const weekStart = new Date(ws);
  weekStart.setDate(ws.getDate() + (week - 1) * 7);
  return { start: format(weekStart, 'yyyy-MM-dd'), end: format(endOfISOWeek(weekStart), 'yyyy-MM-dd') };
}

function parseMonthInput(monthStr: string): { start: string; end: string } {
  const [yearStr, mStr] = monthStr.split('-');
  const date = new Date(parseInt(yearStr), parseInt(mStr) - 1, 1);
  return { start: format(startOfMonth(date), 'yyyy-MM-dd'), end: format(endOfMonth(date), 'yyyy-MM-dd') };
}

function getWeekOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date(); const cws = startOfISOWeek(now);
  for (let i = 0; i < 52; i++) {
    const ws = new Date(cws); ws.setDate(cws.getDate() - i * 7);
    const we = endOfISOWeek(ws);
    options.push({ value: `${getISOWeekYear(ws)}-W${String(getISOWeek(ws)).padStart(2, '0')}`, label: `Week ${getISOWeek(ws)}: ${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}` });
  }
  return options;
}

function getMonthOptions() {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
    const max = y === now.getFullYear() ? now.getMonth() + 1 : 12;
    for (let m = max; m >= 1; m--) {
      options.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: format(new Date(y, m - 1, 1), 'MMMM yyyy') });
    }
  }
  return options;
}

const WEEK_OPTIONS = getWeekOptions();
const MONTH_OPTIONS = getMonthOptions();

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; }

export default function BvReportTab({ guideId, bvslMode, residencyIds }: Props) {
  const [loading, setLoading]           = useState(false);
  const [reportType, setReportType]     = useState<ReportType>('daily');
  const [selectedDate, setSelectedDate] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [selectedWeek, setSelectedWeek] = useState(getDefaultWeek());
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [data, setData]                 = useState<GetBvPreachingReportOutputType | null>(null);
  const [searchQuery, setSearchQuery]   = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');

  const { start: computedStart, end: computedEnd } = useMemo(() => {
    if (reportType === 'weekly') return parseWeekInput(selectedWeek);
    if (reportType === 'monthly') return parseMonthInput(selectedMonth);
    return { start: undefined as string | undefined, end: undefined as string | undefined };
  }, [reportType, selectedWeek, selectedMonth]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBvPreachingReport({
        guideId, date: selectedDate, reportType,
        startDate: computedStart, endDate: computedEnd,
        bvslMode,
        groupId: selectedGroup !== 'all' ? selectedGroup : undefined,
        residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined,
      });
      setData(result);
    } catch { toast.error('Failed to load BVSL report'); }
    finally { setLoading(false); }
  }, [guideId, selectedDate, reportType, computedStart, computedEnd, bvslMode, selectedGroup]);

  const debouncedFetch = useDebouncedCallback(fetchReport, 300);
  useEffect(() => { debouncedFetch(); }, [guideId, reportType, selectedDate, computedStart, computedEnd, selectedGroup]);

  // Available groups from the data (stable, not re-derived unless data changes)
  const availableGroups = useMemo(() => {
    if (!data) return [];
    return (data as any).groups as { id: string; name: string }[] ?? [];
  }, [data]);

  const filteredBvsls = useMemo(() => {
    if (!data) return [];
    let rows = data.bvsls;
    if (searchQuery) rows = rows.filter(r => r.fullName.toLowerCase().includes(searchQuery.toLowerCase()));
    return rows;
  }, [data, searchQuery]);

  const summary = useMemo(() => {
    const submitted = filteredBvsls.filter(r => r.submitted);
    return {
      total: filteredBvsls.length, submitted: submitted.length,
      totalMins: submitted.reduce((s, r) => s + r.totalMinutes, 0),
      totalBooks: submitted.reduce((s, r) => s + r.booksDistributed, 0),
      totalContacts: submitted.reduce((s, r) => s + r.contactsCollected, 0),
      totalOneOnOnes: submitted.reduce((s, r) => s + r.uniqueOneOnOnes, 0),
      avgMins: submitted.length > 0 ? Math.round(submitted.reduce((s, r) => s + r.totalMinutes, 0) / submitted.length) : 0,
      avgBooks: submitted.length > 0 ? Math.round(submitted.reduce((s, r) => s + r.booksDistributed, 0) / submitted.length * 10) / 10 : 0,
    };
  }, [filteredBvsls]);

  const handleExportCsv = () => {
    if (!data) return;
    const headers = ['Rank', 'Name', 'Group', 'Calling', '1-on-1', 'Book Dist', 'RDUA', 'Plan', 'Books', 'Contacts', '1-on-1s', 'Total'];
    const rows = filteredBvsls.filter(r => r.submitted).map((r, i) => [
      i + 1, r.fullName, r.groupName,
      minutesToHHMM(r.callingTime), minutesToHHMM(r.oneOnOneTime), minutesToHHMM(r.bookDistTime),
      minutesToHHMM(r.rduaTime), minutesToHHMM(r.planTime),
      r.booksDistributed, r.contactsCollected, r.uniqueOneOnOnes, minutesToHHMM(r.totalMinutes),
    ]);
    exportToCsv(`bvsl-report-${selectedDate}.csv`, headers, rows);
  };

  const handleExportImage = () => {
    if (!data) return;
    let dateLabel = '';
    if (reportType === 'daily') dateLabel = format(new Date(selectedDate + 'T00:00:00'), 'EEEE, MMM d, yyyy');
    else if (reportType === 'weekly' && computedStart && computedEnd) dateLabel = `${format(new Date(computedStart + 'T00:00:00'), 'MMM d')} – ${format(new Date(computedEnd + 'T00:00:00'), 'MMM d, yyyy')}`;
    else if (reportType === 'monthly') dateLabel = format(new Date(selectedMonth + '-01'), 'MMMM yyyy');
    setTimeout(() => {
      exportBvslReportAsImage(
        filteredBvsls,
        summary,
        dateLabel,
        `bvsl-report-${selectedDate}.png`,
      );
    }, 50);
  };

  const handleWhatsAppReminder = () => {
    if (!data) return;
    const missing = filteredBvsls.filter(r => !r.submitted);
    if (missing.length === 0) { toast.success('All BVSLs have submitted! 🎉'); return; }
    const names = missing.map(r => `• ${r.fullName}`).join('\n');
    const msg = `🙏 Hare Krishna!\n\nKindly submit your Bhakti Vriksha preaching report.\n${window.location.origin}\n\nStill pending (${missing.length}):\n${names}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">BVSL Preaching Report</CardTitle>
              <button onClick={fetchReport} disabled={loading} title="Refresh"
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 text-xs font-medium">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Button size="sm" variant="outline" className="h-8" onClick={handleExportCsv} disabled={!data || loading}>
                <FileDown className="w-3 h-3 mr-1" />CSV
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={handleExportImage} disabled={!data || loading}>
                <Image className="w-3 h-3 mr-1" />Image
              </Button>
              <Button size="sm" variant="outline" className="h-8 border-green-600 text-green-700 hover:bg-green-600 hover:text-white" onClick={handleWhatsAppReminder} disabled={!data || loading}>
                <MessageCircle className="w-3 h-3 mr-1" />Remind
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search by name..." className="pl-8 h-9" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-medium whitespace-nowrap">Type:</Label>
              <Select value={reportType} onValueChange={(v: ReportType) => setReportType(v)}>
                <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportType === 'daily' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Label className="text-sm font-medium whitespace-nowrap">Date:</Label>
                <Button size="sm" variant={selectedDate === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'default' : 'outline'} className="h-8 text-xs px-3"
                  onClick={() => setSelectedDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}>Yesterday</Button>
                <Button size="sm" variant={selectedDate === format(new Date(), 'yyyy-MM-dd') ? 'default' : 'outline'} className="h-8 text-xs px-3"
                  onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}>Today</Button>
                <Input type="date" className="h-8 w-[140px]" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
              </div>
            )}
            {reportType === 'weekly' && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Week:</Label>
                <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                  <SelectTrigger className="h-8 w-[230px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{WEEK_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {reportType === 'monthly' && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Month:</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-60">{MONTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {/* Group filter */}
            {availableGroups.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label className="text-sm font-medium whitespace-nowrap">Group:</Label>
                <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                  <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {availableGroups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!data && loading && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">{[...Array(7)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Card><CardContent className="p-4"><Skeleton className="h-64" /></CardContent></Card>
        </div>
      )}

      {data && (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
          {/* Summary */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Summary</span>
            <span className="text-xs text-muted-foreground">{summary.submitted} of {summary.total} BVSLs submitted</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <SummaryCard icon={Users}     label="Total BVSLs"     value={summary.total} />
            <SummaryCard icon={Clock}     label="Total Preaching"  value={minutesToHHMM(summary.totalMins)} color="text-primary" />
            <SummaryCard icon={Clock}     label="Avg Preaching"    value={minutesToHHMM(summary.avgMins)} color="text-primary" />
            <SummaryCard icon={Package}   label="Total Books"      value={summary.totalBooks} color="text-primary" />
            <SummaryCard icon={Package}   label="Avg Books"        value={summary.avgBooks} color="text-primary" />
            <SummaryCard icon={Phone}     label="Total Contacts"   value={summary.totalContacts} color="text-primary" />
            <SummaryCard icon={UserCheck} label="Total 1-on-1s"    value={summary.totalOneOnOnes} color="text-primary" />
          </div>

          {/* Color key */}
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground items-center">
            <span className="font-medium">Color key:</span>
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">≥30 min / ≥2 count</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">15-29 min / 1 count</span>
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">&lt;15 min / 0 count</span>
            <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">Total ≥120 min</span>
          </div>

          {/* Table */}
          {filteredBvsls.length > 0 ? (
            <>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium sticky left-0 bg-muted/50 z-20 min-w-[28px]">#</th>
                        <th className="p-2 text-left font-medium sticky left-7 bg-muted/50 z-20 min-w-[120px]">Name</th>
                        <th className="p-2 text-left font-medium min-w-[80px]">Group</th>
                        <th className="p-2 text-right font-medium min-w-[68px]">Calling</th>
                        <th className="p-2 text-right font-medium min-w-[60px]">1-on-1</th>
                        <th className="p-2 text-right font-medium min-w-[72px]">Book Dist</th>
                        <th className="p-2 text-right font-medium min-w-[60px]">RDUA</th>
                        <th className="p-2 text-right font-medium min-w-[55px]">Plan</th>
                        <th className="p-2 text-right font-medium min-w-[55px]">Books</th>
                        <th className="p-2 text-right font-medium min-w-[68px]">Contacts</th>
                        <th className="p-2 text-right font-medium min-w-[60px]">1-on-1s</th>
                        <th className="p-2 text-right font-medium min-w-[72px] sticky right-0 bg-muted/50 z-20">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBvsls.map((r, i) => (
                        <BvRow key={r.id} row={r} rank={i + 1} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            </>
          ) : (
            <Card><CardContent className="py-2"><EmptyState title={searchQuery ? `No BVSLs found matching "${searchQuery}"` : 'No BVSLs found.'} /></CardContent></Card>
          )}
        </div>
      )}
    </div>
  );
}

function BvRow({ row, rank }: { row: BvslRow; rank: number }) {
  if (!row.submitted) {
    return (
      <tr className="border-b bg-muted/10">
        <td className="p-2 text-muted-foreground sticky left-0 bg-background z-10">—</td>
        <td className="p-2 sticky left-7 bg-background z-10">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-muted-foreground">{row.fullName}</span>
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-red-300 text-red-600">Missing</Badge>
          </div>
        </td>
        <td className="p-2 text-muted-foreground text-xs">{row.groupName}</td>
        {[...Array(9)].map((_, j) => <td key={j} className="p-2 text-center text-muted-foreground">—</td>)}
      </tr>
    );
  }
  return (
    <tr className="border-b hover:bg-muted/20">
      <td className="p-2 text-muted-foreground text-xs sticky left-0 bg-background z-10">{rank}</td>
      <td className="p-2 font-medium sticky left-7 bg-background z-10 max-w-[160px]">
        <span className="truncate block">{row.fullName}</span>
      </td>
      <td className="p-2 text-muted-foreground text-xs">{row.groupName}</td>
      <DurCell mins={row.callingTime} />
      <DurCell mins={row.oneOnOneTime} />
      <DurCell mins={row.bookDistTime} />
      <DurCell mins={row.rduaTime} />
      <DurCell mins={row.planTime} />
      <CountCell n={row.booksDistributed} />
      <CountCell n={row.contactsCollected} />
      <CountCell n={row.uniqueOneOnOnes} />
      <td className={`p-2 text-right font-mono text-xs sticky right-0 bg-background z-10 ${totalColor(row.totalMinutes)}`}>
        {minutesToHHMM(row.totalMinutes)}
      </td>
    </tr>
  );
}

function DurCell({ mins }: { mins: number }) {
  return (
    <td className="p-2 text-right">
      <span className={`inline-block font-mono text-xs px-1 rounded ${durColor(mins)}`}>{minutesToHHMM(mins)}</span>
    </td>
  );
}

function CountCell({ n }: { n: number }) {
  return (
    <td className="p-2 text-right">
      <span className={`inline-block text-xs px-1.5 rounded font-medium ${countColor(n)}`}>{n}</span>
    </td>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color?: string }) {
  return (
    <Card className="flex-1 min-w-[100px]">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${color || 'text-muted-foreground'}`} /><span className="text-xs text-muted-foreground">{label}</span></div>
        <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
