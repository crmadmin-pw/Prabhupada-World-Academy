/**
 * SuperBvPreachingAnalytics — center-wise BV preaching data for the Super Guide.
 * Shows a summary table: rows = centers, columns = each BV preaching field.
 * Clicking a center expands it to reveal individual BVSL rows.
 * Toggle between Totals and Averages. Overall row always visible at bottom.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getSuperBvAnalytics } from 'zite-endpoints-sdk';
import { useDebouncedCallback } from 'use-debounce';
import {
  format, subDays,
  startOfISOWeek, endOfISOWeek, getISOWeek, getISOWeekYear,
  startOfMonth, endOfMonth,
} from 'date-fns';

// ── Local types ──────────────────────────────────────────────────────────────
type ReportType = 'daily' | 'weekly' | 'monthly';
type ViewMode = 'totals' | 'avgs';

type AggData = {
  callingTime: number; oneOnOneTime: number; bookDistTime: number; rduaTime: number; planTime: number;
  booksDistributed: number; contactsCollected: number; uniqueOneOnOnes: number; totalMinutes: number;
};
type BvslDetail = {
  id: string; fullName: string; groupName: string; submitted: boolean;
  callingTime: number; oneOnOneTime: number; bookDistTime: number; rduaTime: number; planTime: number;
  booksDistributed: number; contactsCollected: number; uniqueOneOnOnes: number; totalMinutes: number;
};
type CenterData = {
  guideId: string; guideName: string; bvslCount: number; submittedCount: number;
  totals: AggData; avgs: AggData; bvsls: BvslDetail[];
};
type AnalyticsData = {
  centers: CenterData[];
  overall: { bvslCount: number; submittedCount: number; totals: AggData; avgs: AggData };
};

// ── Field definitions ────────────────────────────────────────────────────────
type AggKey = keyof AggData;
const DUR_FIELDS: { key: AggKey; label: string }[] = [
  { key: 'callingTime',  label: 'Calling'  },
  { key: 'oneOnOneTime', label: '1-on-1'   },
  { key: 'bookDistTime', label: 'Bk Dist'  },
  { key: 'rduaTime',     label: 'RDUA'     },
  { key: 'planTime',     label: 'Plan'     },
];
const CNT_FIELDS: { key: AggKey; label: string }[] = [
  { key: 'booksDistributed',  label: 'Books'    },
  { key: 'contactsCollected', label: 'Contacts' },
  { key: 'uniqueOneOnOnes',   label: '1-on-1s'  },
];
const ALL_COLS = [...DUR_FIELDS, ...CNT_FIELDS];
const COL_COUNT = 2 + ALL_COLS.length + 1; // center + submitted + fields + total

// ── Helpers ──────────────────────────────────────────────────────────────────
function minsToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function totalColor(mins: number) {
  if (mins >= 120) return 'text-green-700 font-bold';
  if (mins >= 60)  return 'text-amber-700 font-bold';
  if (mins > 0)    return 'text-destructive font-bold';
  return 'text-muted-foreground';
}
function fmtAggVal(val: number, key: AggKey): string {
  const isDur = ['callingTime','oneOnOneTime','bookDistTime','rduaTime','planTime','totalMinutes'].includes(key);
  return isDur ? minsToHHMM(val) : String(val);
}

// ── Week/month date helpers ──────────────────────────────────────────────────
function getDefaultWeek(): string {
  const now = new Date();
  return `${getISOWeekYear(now)}-W${String(getISOWeek(now)).padStart(2, '0')}`;
}
function getWeekOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date(); const cws = startOfISOWeek(now);
  for (let i = 0; i < 52; i++) {
    const ws = new Date(cws); ws.setDate(cws.getDate() - i * 7);
    const we = endOfISOWeek(ws);
    opts.push({ value: `${getISOWeekYear(ws)}-W${String(getISOWeek(ws)).padStart(2, '0')}`, label: `Week ${getISOWeek(ws)}: ${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}` });
  }
  return opts;
}
function getMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
    const max = y === now.getFullYear() ? now.getMonth() + 1 : 12;
    for (let m = max; m >= 1; m--) {
      opts.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: format(new Date(y, m - 1, 1), 'MMMM yyyy') });
    }
  }
  return opts;
}
function parseWeekDates(weekStr: string): { start: string; end: string } {
  const [yr, wStr] = weekStr.split('-W');
  const year = parseInt(yr); const week = parseInt(wStr);
  const jan4 = new Date(year, 0, 4);
  const ws = startOfISOWeek(jan4);
  ws.setDate(ws.getDate() + (week - 1) * 7);
  return { start: format(ws, 'yyyy-MM-dd'), end: format(endOfISOWeek(ws), 'yyyy-MM-dd') };
}
function parseMonthDates(monthStr: string): { start: string; end: string } {
  const [yr, mo] = monthStr.split('-');
  const d = new Date(parseInt(yr), parseInt(mo) - 1, 1);
  return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd') };
}

const WEEK_OPTIONS  = getWeekOptions();
const MONTH_OPTIONS = getMonthOptions();

// ── Main component ───────────────────────────────────────────────────────────
export default function SuperBvPreachingAnalytics() {
  const [loading, setLoading]         = useState(false);
  const [reportType, setReportType]   = useState<ReportType>('daily');
  const [selectedDate, setDate]       = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [selectedWeek, setWeek]       = useState(getDefaultWeek);
  const [selectedMonth, setMonth]     = useState(format(new Date(), 'yyyy-MM'));
  const [data, setData]               = useState<AnalyticsData | null>(null);
  const [viewMode, setViewMode]       = useState<ViewMode>('totals');
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());

  const { start: rangeStart, end: rangeEnd } = useMemo(() => {
    if (reportType === 'weekly')  return parseWeekDates(selectedWeek);
    if (reportType === 'monthly') return parseMonthDates(selectedMonth);
    return { start: undefined as string | undefined, end: undefined as string | undefined };
  }, [reportType, selectedWeek, selectedMonth]);

  const doFetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSuperBvAnalytics({
        date: selectedDate, reportType,
        startDate: rangeStart, endDate: rangeEnd,
      });
      setData(result as AnalyticsData);
    } catch { toast.error('Failed to load BV preaching analytics'); }
    finally { setLoading(false); }
  }, [reportType, selectedDate, rangeStart, rangeEnd]);

  const debouncedFetch = useDebouncedCallback(doFetch, 300);
  useEffect(() => { debouncedFetch(); }, [reportType, selectedDate, rangeStart, rangeEnd]);

  const toggleCenter = (guideId: string) => setExpanded(prev => {
    const next = new Set(prev); next.has(guideId) ? next.delete(guideId) : next.add(guideId); return next;
  });

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
        <button onClick={doFetch} disabled={loading}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40 text-xs font-medium">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>

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
            <Button size="sm" variant={selectedDate === format(subDays(new Date(), 1), 'yyyy-MM-dd') ? 'default' : 'outline'} className="h-8 text-xs px-3"
              onClick={() => setDate(format(subDays(new Date(), 1), 'yyyy-MM-dd'))}>Yesterday</Button>
            <Button size="sm" variant={selectedDate === format(new Date(), 'yyyy-MM-dd') ? 'default' : 'outline'} className="h-8 text-xs px-3"
              onClick={() => setDate(format(new Date(), 'yyyy-MM-dd'))}>Today</Button>
            <Input type="date" className="h-8 w-[140px]" value={selectedDate} onChange={e => setDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
          </div>
        )}
        {reportType === 'weekly' && (
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium whitespace-nowrap">Week:</Label>
            <Select value={selectedWeek} onValueChange={setWeek}>
              <SelectTrigger className="h-8 w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">{WEEK_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        {reportType === 'monthly' && (
          <div className="flex items-center gap-1.5">
            <Label className="text-sm font-medium whitespace-nowrap">Month:</Label>
            <Select value={selectedMonth} onValueChange={setMonth}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">{MONTH_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <Label className="text-xs text-muted-foreground mr-1">Show:</Label>
          <Button size="sm" variant={viewMode === 'totals' ? 'default' : 'outline'} className="h-7 text-xs px-2.5" onClick={() => setViewMode('totals')}>Totals</Button>
          <Button size="sm" variant={viewMode === 'avgs' ? 'default' : 'outline'} className="h-7 text-xs px-2.5" onClick={() => setViewMode('avgs')}>Averages</Button>
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {!data && loading && <Skeleton className="h-72" />}

      {/* ── Table ── */}
      {data && (
        <Card className={loading ? 'opacity-50 pointer-events-none' : ''}>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="px-3 py-2.5 text-left text-xs font-bold sticky left-0 bg-muted/50 z-10 min-w-[150px]">Center</th>
                    <th className="px-3 py-2.5 text-center text-xs font-bold min-w-[80px]">Submitted</th>
                    {DUR_FIELDS.map(f => (
                      <th key={f.key} className="px-3 py-2.5 text-right text-xs font-bold min-w-[70px]">
                        {f.label}<div className="text-[10px] font-normal text-muted-foreground">HH:MM</div>
                      </th>
                    ))}
                    {CNT_FIELDS.map(f => (
                      <th key={f.key} className="px-3 py-2.5 text-right text-xs font-bold min-w-[68px]">
                        {f.label}<div className="text-[10px] font-normal text-muted-foreground">count</div>
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-xs font-bold min-w-[90px] sticky right-0 bg-muted/50 z-10">
                      Total Preaching<div className="text-[10px] font-normal text-muted-foreground">HH:MM</div>
                    </th>
                  </tr>
                  <tr>
                    <td colSpan={COL_COUNT} className="px-3 py-1 text-[10px] text-muted-foreground italic bg-muted/20 border-b border-border">
                      Showing {viewMode === 'totals' ? 'totals across all submitted BVSLs' : 'averages per submitted BVSL'} · Click any center row to expand individual BVSLs
                    </td>
                  </tr>
                </thead>

                <tbody>
                  {data.centers.length === 0 ? (
                    <tr><td colSpan={COL_COUNT} className="text-center py-10 text-muted-foreground text-sm">No data found for this period</td></tr>
                  ) : (
                    data.centers.flatMap(center => {
                      const isOpen = expanded.has(center.guideId);
                      const vals = center[viewMode];
                      return [
                        <tr key={center.guideId}
                          className="border-b border-border hover:bg-muted/20 cursor-pointer transition-colors"
                          onClick={() => toggleCenter(center.guideId)}
                        >
                          <td className="px-3 py-2.5 sticky left-0 bg-card z-10 font-medium">
                            <div className="flex items-center gap-1.5">
                              {isOpen
                                ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                              <span className="truncate max-w-[120px]" title={center.guideName}>{center.guideName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <Badge variant={center.submittedCount === center.bvslCount ? 'default' : 'outline'} className="text-xs">
                              {center.submittedCount}/{center.bvslCount}
                            </Badge>
                          </td>
                          {DUR_FIELDS.map(f => (
                            <td key={f.key} className="px-3 py-2.5 text-right font-mono text-xs">{minsToHHMM(vals[f.key])}</td>
                          ))}
                          {CNT_FIELDS.map(f => (
                            <td key={f.key} className="px-3 py-2.5 text-right text-xs">{vals[f.key]}</td>
                          ))}
                          <td className={`px-3 py-2.5 text-right font-mono text-xs sticky right-0 bg-card z-10 ${totalColor(vals.totalMinutes)}`}>
                            {minsToHHMM(vals.totalMinutes)}
                          </td>
                        </tr>,

                        isOpen && (
                          <tr key={`${center.guideId}-detail`} className="border-b border-border/60 bg-muted/5">
                            <td colSpan={COL_COUNT} className="p-0">
                              <BvslSubTable bvsls={center.bvsls} />
                            </td>
                          </tr>
                        ),
                      ].filter(Boolean) as React.ReactNode[];
                    })
                  )}

                  {/* ── Overall row ── */}
                  {data.centers.length > 0 && (() => {
                    const ov = data.overall[viewMode];
                    return (
                      <tr className="border-t-2 border-primary/30 bg-primary/5 font-bold">
                        <td className="px-3 py-3 sticky left-0 bg-primary/5 z-10 text-primary">
                          Overall
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge className="text-xs">{data.overall.submittedCount}/{data.overall.bvslCount}</Badge>
                        </td>
                        {DUR_FIELDS.map(f => (
                          <td key={f.key} className="px-3 py-3 text-right font-mono text-xs">{minsToHHMM(ov[f.key])}</td>
                        ))}
                        {CNT_FIELDS.map(f => (
                          <td key={f.key} className="px-3 py-3 text-right text-xs">{ov[f.key]}</td>
                        ))}
                        <td className={`px-3 py-3 text-right font-mono text-xs sticky right-0 bg-primary/5 z-10 ${totalColor(ov.totalMinutes)}`}>
                          {minsToHHMM(ov.totalMinutes)}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Expanded BVSL sub-table ──────────────────────────────────────────────────
function BvslSubTable({ bvsls }: { bvsls: BvslDetail[] }) {
  return (
    <div className="px-6 py-3">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Individual BVSLs</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border/50">
              <th className="pb-1.5 text-left font-semibold text-muted-foreground min-w-[120px]">Name</th>
              <th className="pb-1.5 text-left font-semibold text-muted-foreground min-w-[90px]">Group</th>
              {DUR_FIELDS.map(f => <th key={f.key} className="pb-1.5 text-right font-semibold text-muted-foreground min-w-[60px]">{f.label}</th>)}
              {CNT_FIELDS.map(f => <th key={f.key} className="pb-1.5 text-right font-semibold text-muted-foreground min-w-[55px]">{f.label}</th>)}
              <th className="pb-1.5 text-right font-semibold text-muted-foreground min-w-[72px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {bvsls.map(bvsl => (
              <tr key={bvsl.id} className={`border-b border-border/30 last:border-0 ${!bvsl.submitted ? 'opacity-50' : ''}`}>
                <td className="py-1.5 font-medium">
                  {bvsl.fullName}
                  {!bvsl.submitted && <span className="ml-1 text-destructive font-normal">(missing)</span>}
                </td>
                <td className="py-1.5 text-muted-foreground">{bvsl.groupName}</td>
                {DUR_FIELDS.map(f => <td key={f.key} className="py-1.5 text-right font-mono">{minsToHHMM(bvsl[f.key])}</td>)}
                {CNT_FIELDS.map(f => <td key={f.key} className="py-1.5 text-right">{bvsl[f.key]}</td>)}
                <td className={`py-1.5 text-right font-mono ${totalColor(bvsl.totalMinutes)}`}>{minsToHHMM(bvsl.totalMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
