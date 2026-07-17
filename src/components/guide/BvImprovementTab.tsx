/**
 * BvImprovementTab — client-side BV improvement analysis.
 * Mirrors ImprovementTab but for BVSL preaching metrics.
 * Uses getBvPreachingReport data to compute field loss and low performers.
 */
import { useState, useEffect, useMemo } from 'react';
import { format, subDays, startOfMonth, endOfMonth, startOfISOWeek, endOfISOWeek, subWeeks, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingDown, Users, RefreshCw, Lightbulb, CheckCircle2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getBvPreachingReport } from 'zite-endpoints-sdk';
import type { GetBvPreachingReportOutputType } from 'zite-endpoints-sdk';

type Period = 'prev_week' | 'prev_month' | 'this_month';
type BvslRow = GetBvPreachingReportOutputType['bvsls'][0];

const PERIOD_LABELS: Record<Period, string> = {
  'prev_week':  'Previous Week',
  'prev_month': 'Previous Month',
  'this_month': 'This Month',
};

// BV field thresholds (in minutes for duration fields, counts for count fields)
interface BvFieldDef {
  key: string;
  label: string;
  unit: 'min' | 'count';
  target: number;
  tip: string;
}

const BV_FIELDS: BvFieldDef[] = [
  { key: 'totalMinutes',     label: 'Total Preaching', unit: 'min',   target: 120, tip: 'Encourage BVSLs to aim for at least 2 hours of total preaching activity per day.' },
  { key: 'callingTime',      label: 'Calling Time',    unit: 'min',   target: 30,  tip: 'BVSLs should spend at least 30 minutes calling contacts and prospects.' },
  { key: 'oneOnOneTime',     label: '1-on-1 Time',     unit: 'min',   target: 30,  tip: 'Encourage at least 30 minutes of personal 1-on-1 interactions per day.' },
  { key: 'bookDistTime',     label: 'Book Dist Time',  unit: 'min',   target: 30,  tip: 'Encourage BVSLs to spend 30+ minutes distributing books.' },
  { key: 'booksDistributed', label: 'Books Distributed', unit: 'count', target: 2, tip: 'Aim for distributing at least 2 books per preaching session.' },
  { key: 'contactsCollected',label: 'Contacts Collected', unit: 'count', target: 2, tip: 'Collecting 2+ new contacts per session keeps the pipeline active.' },
  { key: 'uniqueOneOnOnes',  label: 'Unique 1-on-1s',  unit: 'count', target: 2,  tip: 'Encourage at least 2 unique personal interactions per session.' },
];

function formatValue(val: number, unit: 'min' | 'count'): string {
  if (unit === 'count') return String(val);
  const h = Math.floor(val / 60);
  const m = Math.round(val % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getPeriodParams(period: Period): { date: string; startDate: string; endDate: string; reportType: 'daily' | 'weekly' | 'monthly' } {
  const today = new Date();
  if (period === 'prev_week') {
    const lw = subWeeks(today, 1);
    const start = format(startOfISOWeek(lw), 'yyyy-MM-dd');
    const end   = format(endOfISOWeek(lw), 'yyyy-MM-dd');
    return { date: start, startDate: start, endDate: end, reportType: 'weekly' };
  }
  if (period === 'prev_month') {
    const lm = subMonths(today, 1);
    return { date: format(startOfMonth(lm), 'yyyy-MM-dd'), startDate: format(startOfMonth(lm), 'yyyy-MM-dd'), endDate: format(endOfMonth(lm), 'yyyy-MM-dd'), reportType: 'monthly' };
  }
  // this_month
  return { date: format(startOfMonth(today), 'yyyy-MM-dd'), startDate: format(startOfMonth(today), 'yyyy-MM-dd'), endDate: format(today, 'yyyy-MM-dd'), reportType: 'monthly' };
}

interface FieldLossRow {
  def: BvFieldDef;
  avgValue: number;
  deficit: number;
  belowCount: number;
  totalCount: number;
}

function computeFieldLoss(submitted: BvslRow[]): FieldLossRow[] {
  if (submitted.length === 0) return [];
  return BV_FIELDS.map(def => {
    const values = submitted.map(r => Number((r as any)[def.key]) || 0);
    const avgValue = Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10;
    const deficit  = Math.max(0, def.target - avgValue);
    const belowCount = values.filter(v => v < def.target).length;
    return { def, avgValue, deficit, belowCount, totalCount: submitted.length };
  }).filter(r => r.deficit > 0).sort((a, b) => b.deficit - a.deficit);
}

interface LowPerformer extends BvslRow {
  weakFields: { def: BvFieldDef; val: number; deficit: number }[];
}

function computeLowPerformers(submitted: BvslRow[]): LowPerformer[] {
  return submitted
    .filter(r => {
      // Below target on total preaching OR 2+ other fields
      const totalOk = r.totalMinutes >= 120;
      const belowFields = BV_FIELDS.filter(d => Number((r as any)[d.key]) < d.target).length;
      return !totalOk || belowFields >= 2;
    })
    .map(r => {
      const weakFields = BV_FIELDS
        .map(def => ({ def, val: Number((r as any)[def.key]) || 0, deficit: Math.max(0, def.target - (Number((r as any)[def.key]) || 0)) }))
        .filter(f => f.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);
      return { ...r, weakFields };
    })
    .sort((a, b) => b.weakFields.length - a.weakFields.length);
}

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; }

export default function BvImprovementTab({ guideId, bvslMode, residencyIds }: Props) {
  const [period, setPeriod]   = useState<Period>('prev_week');
  const [loading, setLoading] = useState(false);
  const [data, setData]       = useState<GetBvPreachingReportOutputType | null>(null);

  const load = () => {
    const params = getPeriodParams(period);
    setLoading(true);
    getBvPreachingReport({ guideId, ...params, bvslMode, residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined })
      .then(res => setData(res as any))
      .catch(() => toast.error('Failed to load improvement data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [guideId, period, bvslMode]);

  const submitted    = useMemo(() => (data?.bvsls || []).filter(r => r.submitted), [data]);
  const fieldLoss    = useMemo(() => computeFieldLoss(submitted), [submitted]);
  const lowPerformers = useMemo(() => computeLowPerformers(submitted), [submitted]);

  const actionPlan = useMemo(() => {
    const items: { priority: 'high' | 'medium' | 'low'; row: FieldLossRow }[] = [];
    fieldLoss.slice(0, 5).forEach((row, i) => {
      items.push({ priority: i === 0 ? 'high' : i === 1 ? 'medium' : 'low', row });
    });
    return items;
  }, [fieldLoss]);

  const { startDate, endDate } = getPeriodParams(period);
  const rangeLabel = `${startDate} → ${endDate}`;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
              {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden sm:block">{rangeLabel}</span>
              <span className="text-xs text-muted-foreground">{submitted.length}/{data?.bvsls?.length ?? 0} submitted</span>
              <button onClick={load} disabled={loading}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : submitted.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
          No submitted entries in this period. Try a different date range.
        </CardContent></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Action plan first */}
          {actionPlan.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                  Action Plan — What to Improve
                </CardTitle>
                <CardDescription className="text-xs">
                  Top fields where BVSLs are falling short of targets
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {actionPlan.map(({ priority, row }, i) => (
                  <div key={row.def.key} className={`p-3.5 rounded-lg border ${
                    priority === 'high' ? 'border-destructive/30 bg-destructive/5'
                    : priority === 'medium' ? 'border-amber-300/50 bg-amber-50/40'
                    : 'border-border bg-muted/30'}`}>
                    <div className="flex items-start gap-2.5">
                      <span className="text-lg shrink-0">{priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <p className="font-bold text-sm">{row.def.label}</p>
                          <Badge variant="outline" className="text-xs border-primary/40 text-primary">👥 All BVSLs</Badge>
                          <span className={`text-xs font-semibold ${priority === 'high' ? 'text-destructive' : priority === 'medium' ? 'text-amber-600' : 'text-muted-foreground'}`}>
                            {priority === 'high' ? '— Urgent' : priority === 'medium' ? '— Attention needed' : '— Keep an eye'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                          {row.belowCount} of {row.totalCount} BVSLs are below target ({formatValue(row.def.target, row.def.unit)}).
                          {' '}Group avg: {formatValue(row.avgValue, row.def.unit)} vs target {formatValue(row.def.target, row.def.unit)}.
                        </p>
                        <div className="flex items-start gap-2 bg-background rounded-md px-2.5 py-2 border border-border/60">
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                          <p className="text-xs font-medium leading-relaxed">{row.def.tip}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Field Loss */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingDown className="w-4 h-4 text-destructive" />
                  Where Are BVSLs Falling Short?
                </CardTitle>
                <CardDescription className="text-xs">
                  BV fields ranked by how far below target — {submitted.length} BVSLs submitted
                </CardDescription>
              </CardHeader>
              <CardContent>
                {fieldLoss.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="font-semibold text-sm text-green-600">All BVSLs are meeting targets!</p>
                    <p className="text-xs text-muted-foreground mt-1">Excellent preaching work — keep it up 🙏</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fieldLoss.map((row, i) => {
                      const fillPct = row.def.target > 0 ? Math.min(100, (row.avgValue / row.def.target) * 100) : 0;
                      const bgClass = i === 0 ? 'bg-destructive/8 border-destructive/25' : i === 1 ? 'bg-orange-50 border-orange-200' : i <= 3 ? 'bg-amber-50 border-amber-200' : 'bg-muted/40 border-border';
                      const barClass = i === 0 ? 'bg-destructive' : i === 1 ? 'bg-orange-500' : i <= 3 ? 'bg-amber-500' : 'bg-muted-foreground/50';
                      const textClass = i === 0 ? 'text-destructive' : i === 1 ? 'text-orange-700' : 'text-amber-700';
                      return (
                        <div key={row.def.key} className={`p-3 rounded-lg border ${bgClass}`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className={`text-base font-black shrink-0 leading-tight ${textClass}`}>{i + 1}.</span>
                              <div>
                                <p className="font-semibold text-sm">{row.def.label}</p>
                                <p className={`text-xs mt-0.5 font-medium ${textClass}`}>
                                  {row.belowCount}/{row.totalCount} below target · avg {formatValue(row.avgValue, row.def.unit)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={`text-sm font-bold ${textClass}`}>{formatValue(row.avgValue, row.def.unit)}</p>
                              <p className="text-[10px] text-muted-foreground">target: {formatValue(row.def.target, row.def.unit)}</p>
                            </div>
                          </div>
                          <div className="h-2 bg-background/70 rounded-full overflow-hidden">
                            <div className={`h-full ${barClass} rounded-full`} style={{ width: `${fillPct}%` }} />
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 text-right">{Math.round(fillPct)}% of target</div>
                        </div>
                      );
                    })}
                    {/* Fields meeting targets */}
                    {BV_FIELDS.filter(def => !fieldLoss.find(r => r.def.key === def.key)).length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-green-600" /> Meeting targets
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {BV_FIELDS.filter(def => !fieldLoss.find(r => r.def.key === def.key)).map(def => (
                            <div key={def.key} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-green-50 border border-green-200">
                              <CheckCircle className="w-3 h-3 text-green-600 shrink-0" />
                              <span className="text-xs font-medium text-green-800 truncate">{def.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Who needs attention */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-amber-600" />
                  Who Needs Personal Attention?
                  {lowPerformers.length > 0 && (
                    <Badge variant="outline" className="text-xs text-amber-700 border-amber-400 ml-1">
                      {lowPerformers.length} below targets
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  BVSLs missing targets — missing total preaching or 2+ fields
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lowPerformers.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="font-semibold text-sm text-green-600">All BVSLs are meeting targets!</p>
                    <p className="text-xs text-muted-foreground mt-1">Great preaching engagement — keep it up 🙏</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lowPerformers.map(u => (
                      <div key={u.id} className={`p-3 rounded-lg border ${u.totalMinutes < 60 ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-amber-400'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate mb-1.5">{u.fullName}</p>
                            <div className="flex flex-wrap gap-1">
                              {u.weakFields.slice(0, 3).map(f => (
                                <span key={f.def.key} className="text-xs bg-destructive/8 text-destructive border border-destructive/20 rounded px-1.5 py-0.5">
                                  {f.def.label}: {formatValue(f.val, f.def.unit)} / {formatValue(f.def.target, f.def.unit)}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-base font-bold ${u.totalMinutes >= 120 ? 'text-green-600' : u.totalMinutes >= 60 ? 'text-amber-600' : 'text-destructive'}`}>
                              {u.totalMinutes >= 120 ? '✓' : u.totalMinutes >= 60 ? '~' : '✗'}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {Math.floor(u.totalMinutes / 60)}h{Math.round(u.totalMinutes % 60)}m
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground pt-1 text-center border-t">
                      Speak personally with BVSLs who are consistently missing targets
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
