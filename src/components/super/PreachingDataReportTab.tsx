import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target, Search } from 'lucide-react';
import { toast } from 'sonner';
import { getPreachingDataReport } from 'zite-endpoints-sdk';
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { useUserProfile } from '@/contexts/UserProfileContext';
import PreachingMetricSection from './PreachingMetricSection';
import PreachingGoalsEditor from './PreachingGoalsEditor';
import CrossCenterPreachingReport from './CrossCenterPreachingReport';
import AdminScoresReport from './AdminScoresReport';

interface Center { id: string; name: string; shortName: string; }
interface Week { start: string; end: string; label: string; }
interface MetricRow { centerId: string; centerName: string; yearlyGoal: number; initial: number; cumulative: number; weeklyData: Record<string, number | null>; }
interface Metric { key: string; label: string; rows: MetricRow[]; }
interface GoalItem { metricName: string; centerId: string; yearlyGoal: number; initialValue: number; }
interface ReportData { centers: Center[]; weeks: Week[]; metrics: Metric[]; goals: GoalItem[]; }

type PreachingSortMode = 'center' | 'cumulative-desc' | 'goal-desc';

export default function PreachingDataReportTab() {
  const { profile } = useUserProfile();
  const today = new Date();
  const [startDate, setStartDate] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);

  // Filters
  const [centerSearch, setCenterSearch] = useState('');
  const [sortMode, setSortMode] = useState<PreachingSortMode>('center');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPreachingDataReport({ startDate, endDate });
      setData(result as ReportData);
    } catch { toast.error('Failed to load preaching report'); }
    finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const isSuperGuide = profile?.role === 'SUPER_GUIDE';
  const isGuide = profile?.role === 'GUIDE';
  const canEditGoals = isSuperGuide || isGuide;

  const editorCenters = (data?.centers ?? [])
    .map(c => ({ id: c.id, shortName: c.shortName }))
    .filter(c => {
      if (isSuperGuide) return true;
      const residency = profile?.selectedFolkResidency;
      if (!residency) return false;
      const ids = Array.isArray(residency) ? residency : [residency];
      return ids.includes(c.id);
    });

  // Apply search and sort to each metric's rows
  const sortRows = (rows: MetricRow[]): MetricRow[] => {
    let result = rows;
    if (centerSearch) {
      const q = centerSearch.toLowerCase();
      result = result.filter(r => r.centerName.toLowerCase().includes(q));
    }
    const sorted = [...result];
    switch (sortMode) {
      case 'center':
        sorted.sort((a, b) => a.centerName.localeCompare(b.centerName));
        break;
      case 'cumulative-desc':
        sorted.sort((a, b) => (b.cumulative || 0) - (a.cumulative || 0));
        break;
      case 'goal-desc':
        sorted.sort((a, b) => (b.yearlyGoal || 0) - (a.yearlyGoal || 0));
        break;
    }
    return sorted;
  };

  return (
    <div className="space-y-4">
      {/* Controls Row 1: Dates */}
      <div className="flex flex-wrap gap-3 items-end">
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
            onClick={() => { setStartDate(format(startOfMonth(today), 'yyyy-MM-dd')); setEndDate(format(endOfMonth(today), 'yyyy-MM-dd')); }}>
            This Month
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => { setStartDate(format(startOfMonth(subMonths(today, 2)), 'yyyy-MM-dd')); setEndDate(format(endOfMonth(today), 'yyyy-MM-dd')); }}>
            Last 3 Months
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => { setStartDate(format(startOfYear(today), 'yyyy-MM-dd')); setEndDate(format(endOfYear(today), 'yyyy-MM-dd')); }}>
            This Year
          </Button>
        </div>
        {canEditGoals && (
          <Button size="sm" variant="outline" className="h-8 text-xs ml-auto gap-1.5"
            onClick={() => setGoalsOpen(true)}>
            <Target className="w-3.5 h-3.5" /> Edit Goals
          </Button>
        )}
      </div>

      {/* Controls Row 2: Search & Sort */}
      <div className="flex flex-wrap items-center gap-2 bg-card border rounded-lg p-2.5">
        <div className="relative flex-1 min-w-[160px] max-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Filter centers..."
            value={centerSearch}
            onChange={e => setCenterSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={sortMode} onValueChange={v => setSortMode(v as PreachingSortMode)}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="center">Sort: Center Name</SelectItem>
            <SelectItem value="cumulative-desc">Sort: Cumulative ↓</SelectItem>
            <SelectItem value="goal-desc">Sort: Yearly Goal ↓</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : data ? (
        <div className="space-y-3">
          {data.metrics.map((metric, i) => (
            <PreachingMetricSection
              key={metric.key}
              index={i}
              metricKey={metric.key}
              metricLabel={metric.label}
              weeks={data.weeks}
              rows={sortRows(metric.rows)}
              defaultOpen={i === 0}
              startDate={startDate}
              endDate={endDate}
            />
          ))}
        </div>
      ) : null}

      {/* Goals editor */}
      {goalsOpen && data && (
        <PreachingGoalsEditor
          open={goalsOpen}
          onClose={() => { setGoalsOpen(false); loadData(); }}
          centers={editorCenters}
          existingGoals={data.goals}
        />
      )}

      {/* Cross-Center Preaching Report (from FOLKHub CRM) */}
      <div className="border-t border-border pt-6 mt-6">
        <CrossCenterPreachingReport />
      </div>

      {/* Volunteer Scores Report */}
      <div className="border-t border-border pt-6 mt-6">
        <AdminScoresReport />
      </div>
    </div>
  );
}
