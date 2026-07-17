import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format, subWeeks, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { getCrossPreachingReport } from 'zite-endpoints-sdk';
import CrossCenterMetricSection from './CrossCenterMetricSection';
import CrossCenterDrilldownDialog from './CrossCenterDrilldownDialog';

interface WeekVal { weekLabel: string; weekStart: string; value: number }
interface CenterData { centerName: string; centerId: string; cumulative: number; weeks: WeekVal[] }
interface MetricData { metric: string; emoji: string; centers: CenterData[]; total: CenterData }
interface WeekInfo { label: string; start: string; end: string }
interface ReportData { metrics: MetricData[]; weeks: WeekInfo[]; dateRange: { from: string; to: string } }

type DrillState = { title: string; metric: string; centerId: string; weekStart: string; weekEnd: string };

export default function CrossCenterPreachingReport() {
  const today = new Date();
  const [startDate, setStartDate] = useState(format(subWeeks(today, 4), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState<DrillState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getCrossPreachingReport({ from: startDate, to: endDate });
      setData(res as any);
    } catch { toast.error('Failed to load cross-center report'); }
    finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const setQuick = (from: string, to: string) => { setStartDate(from); setEndDate(to); };

  const handleCellClick = (metric: string, centerId: string, centerName: string, weekLabel: string, weekStart: string, weekEnd: string) => {
    setDrill({
      title: `${metric} — ${centerName}${weekLabel !== 'Cumulative' ? ` (${weekLabel})` : ''}`,
      metric,
      centerId,
      weekStart: weekLabel === 'Cumulative' ? startDate : weekStart,
      weekEnd: weekLabel === 'Cumulative' ? endDate : weekEnd,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-bold flex items-center gap-2">🌍 Cross-Center Preaching Report</h3>
        <p className="text-xs text-muted-foreground">5 key metrics across all FOLK centers from the FOLKHub CRM</p>
      </div>

      {/* Date controls */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs whitespace-nowrap">From</Label>
          <Input type="date" className="h-8 w-[140px] text-xs" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs whitespace-nowrap">To</Label>
          <Input type="date" className="h-8 w-[140px] text-xs" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setQuick(format(subWeeks(today, 4), 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd'))}>
            Last 4 Weeks
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setQuick(format(startOfMonth(today), 'yyyy-MM-dd'), format(endOfMonth(today), 'yyyy-MM-dd'))}>
            This Month
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setQuick(format(startOfMonth(subMonths(today, 2)), 'yyyy-MM-dd'), format(endOfMonth(today), 'yyyy-MM-dd'))}>
            Last 3 Months
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setQuick(format(startOfYear(today), 'yyyy-MM-dd'), format(endOfYear(today), 'yyyy-MM-dd'))}>
            This Year
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : data ? (
        <div className="space-y-3">
          {data.metrics.map((m, i) => (
            <CrossCenterMetricSection
              key={m.metric}
              metric={m.metric}
              emoji={m.emoji}
              centers={m.centers}
              total={m.total}
              weeks={data.weeks}
              defaultOpen={i === 0}
              onCellClick={(cid, cname, wl, ws, we) => handleCellClick(m.metric, cid, cname, wl, ws, we)}
            />
          ))}
        </div>
      ) : null}

      {drill && (
        <CrossCenterDrilldownDialog
          open={true}
          onClose={() => setDrill(null)}
          title={drill.title}
          metric={drill.metric}
          centerId={drill.centerId}
          weekStart={drill.weekStart}
          weekEnd={drill.weekEnd}
        />
      )}
    </div>
  );
}
