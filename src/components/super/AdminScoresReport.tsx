import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, subWeeks, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { getScoresReport } from 'zite-endpoints-sdk';
import ScoresMetricSection from './ScoresMetricSection';
import ScoresDrilldownDialog from './ScoresDrilldownDialog';

type Level = 'center' | 'team' | 'individual';
type ViewMode = 'points' | 'actual';

interface Score {
  volunteerId: string; volunteerName: string; teamId: string; teamName: string;
  centerId: string; centerName: string; weekId: string; weekStart: string; weekEnd: string;
  booksPoints: number; booksCount: number; contactsPoints: number; contactsCount: number;
  attendancePoints: number; newLeadsPoints: number; oneOnOnePoints: number;
  overnightStaysPoints: number; callingPoints: number; callingCount: number;
}

interface WeekInfo { id: string; start: string; end: string }

const METRICS = [
  { key: 'books', label: 'Books', emoji: '📚', pointsField: 'booksPoints', actualField: 'booksCount' },
  { key: 'contacts', label: 'Contacts', emoji: '👥', pointsField: 'contactsPoints', actualField: 'contactsCount' },
  { key: 'attendance', label: 'Attendance', emoji: '📅', pointsField: 'attendancePoints', actualField: 'attendancePoints' },
  { key: 'newLeads', label: 'New Leads', emoji: '🌱', pointsField: 'newLeadsPoints', actualField: 'newLeadsPoints' },
  { key: 'oneOnOne', label: '1-on-1s', emoji: '🤝', pointsField: 'oneOnOnePoints', actualField: 'oneOnOnePoints' },
  { key: 'overnightStays', label: 'Overnight Stays', emoji: '🏠', pointsField: 'overnightStaysPoints', actualField: 'overnightStaysPoints' },
  { key: 'calling', label: 'Calling', emoji: '📞', pointsField: 'callingPoints', actualField: 'callingCount' },
] as const;

type DrillState = { title: string; metric: string; entityId: string; entityType: Level; weekStart: string; weekEnd: string };

export default function AdminScoresReport() {
  const today = new Date();
  const [startDate, setStartDate] = useState(format(subWeeks(today, 4), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(today, 'yyyy-MM-dd'));
  const [scores, setScores] = useState<Score[]>([]);
  const [weeks, setWeeks] = useState<WeekInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<Level>('center');
  const [viewMode, setViewMode] = useState<ViewMode>('points');
  const [drill, setDrill] = useState<DrillState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getScoresReport({ from: startDate, to: endDate }) as any;
      setScores(res.scores || []);
      setWeeks(res.weeks || []);
    } catch { toast.error('Failed to load scores'); }
    finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const setQuick = (from: string, to: string) => { setStartDate(from); setEndDate(to); };

  // Aggregate data based on level
  const aggregatedRows = useMemo(() => {
    const result: Record<string, {
      rows: { id: string; name: string; cumulative: number; weekValues: { weekId: string; value: number }[] }[];
    }> = {};

    for (const m of METRICS) {
      const field = viewMode === 'points' ? m.pointsField : m.actualField;

      if (level === 'individual') {
        // Group by volunteer across weeks
        const volAgg = new Map<string, { name: string; weekVals: Map<string, number> }>();
        for (const s of scores) {
          if (!volAgg.has(s.volunteerId)) volAgg.set(s.volunteerId, { name: s.volunteerName, weekVals: new Map() });
          const v = volAgg.get(s.volunteerId)!;
          v.weekVals.set(s.weekId, (v.weekVals.get(s.weekId) || 0) + (s[field as keyof Score] as number || 0));
        }
        result[m.key] = {
          rows: [...volAgg.entries()].map(([id, data]) => {
            const weekValues = weeks.map(w => ({ weekId: w.id, value: data.weekVals.get(w.id) || 0 }));
            return { id, name: data.name, cumulative: weekValues.reduce((s, v) => s + v.value, 0), weekValues };
          }).filter(r => r.cumulative > 0),
        };
      } else if (level === 'team') {
        const teamAgg = new Map<string, { name: string; weekVals: Map<string, number> }>();
        for (const s of scores) {
          const key = s.teamId || 'unknown';
          if (!teamAgg.has(key)) teamAgg.set(key, { name: s.teamName || 'Unknown Team', weekVals: new Map() });
          const t = teamAgg.get(key)!;
          t.weekVals.set(s.weekId, (t.weekVals.get(s.weekId) || 0) + (s[field as keyof Score] as number || 0));
        }
        result[m.key] = {
          rows: [...teamAgg.entries()].map(([id, data]) => {
            const weekValues = weeks.map(w => ({ weekId: w.id, value: data.weekVals.get(w.id) || 0 }));
            return { id, name: data.name, cumulative: weekValues.reduce((s, v) => s + v.value, 0), weekValues };
          }).filter(r => r.cumulative > 0),
        };
      } else {
        // Center
        const centerAgg = new Map<string, { name: string; weekVals: Map<string, number> }>();
        for (const s of scores) {
          if (!centerAgg.has(s.centerId)) centerAgg.set(s.centerId, { name: s.centerName, weekVals: new Map() });
          const c = centerAgg.get(s.centerId)!;
          c.weekVals.set(s.weekId, (c.weekVals.get(s.weekId) || 0) + (s[field as keyof Score] as number || 0));
        }
        result[m.key] = {
          rows: [...centerAgg.entries()].map(([id, data]) => {
            const weekValues = weeks.map(w => ({ weekId: w.id, value: data.weekVals.get(w.id) || 0 }));
            return { id, name: data.name, cumulative: weekValues.reduce((s, v) => s + v.value, 0), weekValues };
          }).filter(r => r.cumulative > 0),
        };
      }
    }

    return result;
  }, [scores, weeks, level, viewMode]);

  const handleCellClick = (metricLabel: string, entityId: string, entityName: string, weekId: string, weekStart: string, weekEnd: string) => {
    const metricKey = METRICS.find(m => m.label === metricLabel)?.key || metricLabel;
    setDrill({
      title: `${metricLabel} — ${entityName}${weekId !== 'Cumulative' ? ` (${weekId})` : ''}`,
      metric: metricLabel,
      entityId,
      entityType: level,
      weekStart: weekId === 'Cumulative' ? startDate : weekStart,
      weekEnd: weekId === 'Cumulative' ? endDate : weekEnd,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-bold flex items-center gap-2">🏆 Volunteer Scores Report</h3>
        <p className="text-xs text-muted-foreground">7 metrics scoring volunteers across all FOLK centers</p>
      </div>

      {/* Controls */}
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

      {/* Level and View toggles */}
      <div className="flex flex-wrap gap-3">
        <Tabs value={level} onValueChange={v => setLevel(v as Level)}>
          <TabsList className="h-8">
            <TabsTrigger value="center" className="text-xs h-7 gap-1">🏢 Center</TabsTrigger>
            <TabsTrigger value="team" className="text-xs h-7 gap-1">👥 Team</TabsTrigger>
            <TabsTrigger value="individual" className="text-xs h-7 gap-1">👤 Individual</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={viewMode} onValueChange={v => setViewMode(v as ViewMode)}>
          <TabsList className="h-8">
            <TabsTrigger value="points" className="text-xs h-7 gap-1">🏆 Points</TabsTrigger>
            <TabsTrigger value="actual" className="text-xs h-7 gap-1">📊 Actual</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {METRICS.map((m, i) => (
            <ScoresMetricSection
              key={m.key}
              metric={m.label}
              emoji={m.emoji}
              rows={aggregatedRows[m.key]?.rows || []}
              weeks={weeks}
              defaultOpen={i === 0}
              showPoints={viewMode === 'points'}
              onCellClick={(eid, ename, wid, ws, we) => handleCellClick(m.label, eid, ename, wid, ws, we)}
            />
          ))}
        </div>
      )}

      {drill && (
        <ScoresDrilldownDialog
          open={true}
          onClose={() => setDrill(null)}
          title={drill.title}
          metric={drill.metric}
          entityId={drill.entityId}
          entityType={drill.entityType}
          weekStart={drill.weekStart}
          weekEnd={drill.weekEnd}
        />
      )}
    </div>
  );
}
