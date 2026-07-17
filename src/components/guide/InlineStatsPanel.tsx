/**
 * InlineStatsPanel — embedded in the ReportsTab below the summary cards.
 * Computes all metrics from the already-loaded + filtered clientFilteredUsers data.
 * No extra API call — stats respond instantly to all report filters.
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Music2, BookOpen, Headphones, TrendingUp, ArrowUp, ArrowDown, Minus, ChevronDown, ChevronUp, Moon } from 'lucide-react';
import { scoreColor } from '@/lib/scoring';

interface ReportUser {
  userId: string; fullName: string; ashrayLevel?: string | null;
  isResident: boolean; submitted: boolean;
  scorePercent?: number | null;
  chantingRaw?: number | null; readingRaw?: number | null; hearingRaw?: number | null;
  currentStreak?: number;
  fieldScores: Record<string, any>;
  residencyId?: string | null;
}

interface Residency { residencyId: string; residencyName: string; }

interface Props {
  users: ReportUser[];
  residencies: Residency[];
  residencyFilter: string;
}

type SortKey = 'fullName' | 'scorePercent' | 'submitted';
type SortDir = 'asc' | 'desc';

function avg(vals: number[]): number | null {
  const nonZero = vals.filter(v => v > 0);
  if (!nonZero.length) return null;
  return Math.round(nonZero.reduce((a, b) => a + b, 0) / nonZero.length * 10) / 10;
}

export default function InlineStatsPanel({ users, residencies, residencyFilter }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('scorePercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Scholars excluded from metrics — they're monitored separately
  const submitted = useMemo(() => users.filter(u => u.submitted && !(u as any).isTempResident), [users]);

  const metrics = useMemo(() => {
    const scores = submitted.map(u => u.scorePercent ?? 0).filter(s => s > 0);
    const rounds = submitted.map(u => u.chantingRaw ?? 0);
    const reading = submitted.map(u => u.readingRaw ?? 0);
    const hearing = submitted.map(u => u.hearingRaw ?? 0).filter(v => v > 0);
    const sbVals = submitted
      .filter(u => u.isResident)
      .map(u => typeof u.fieldScores['sb'] === 'number' ? u.fieldScores['sb'] : null)
      .filter((v): v is number => v != null);
    const sleepQ = submitted
      .filter(u => u.isResident)
      .map(u => typeof u.fieldScores['sleep_quality'] === 'number' ? u.fieldScores['sleep_quality'] : null)
      .filter((v): v is number => v != null);
    // Sleep duration — sleep_minutes is a raw number (minutes)
    const sleepMinsArr = submitted
      .filter(u => u.isResident)
      .map(u => {
        const v = u.fieldScores['sleep_minutes'];
        return typeof v === 'number' && v > 0 ? v : null;
      })
      .filter((v): v is number => v != null && v > 0);
    return {
      avgScore: avg(scores),
      avgRounds: avg(rounds),
      avgReading: avg(reading),
      avgHearing: avg(hearing),
      avgSb: avg(sbVals),
      avgSleepQ: avg(sleepQ),
      avgSleepHrs: sleepMinsArr.length > 0
        ? Math.round(sleepMinsArr.reduce((a, b) => a + b, 0) / sleepMinsArr.length / 6) / 10
        : null,
      submittedCount: submitted.length,
      totalCount: users.length,
    };
  }, [submitted, users]);

  const sorted = useMemo(() => {
    return [...users].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
      else if (sortKey === 'scorePercent') cmp = (a.scorePercent ?? -1) - (b.scorePercent ?? -1);
      else if (sortKey === 'submitted') cmp = (a.submitted ? 1 : 0) - (b.submitted ? 1 : 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [users, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => (
    sortKey === col
      ? (sortDir === 'desc' ? <ChevronDown className="w-3 h-3 inline ml-0.5" /> : <ChevronUp className="w-3 h-3 inline ml-0.5" />)
      : null
  );

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors"
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          📊 Stats Overview
          <span className="text-xs font-normal text-muted-foreground">
            {metrics.submittedCount}/{metrics.totalCount} submitted
            {metrics.avgScore != null && ` · avg ${metrics.avgScore}%`}
          </span>
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 bg-card">
          {/* Key metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {[
              { icon: <TrendingUp className="w-3.5 h-3.5 text-green-600" />, label: 'Avg Score', val: metrics.avgScore != null ? `${metrics.avgScore}%` : '—', colored: true, raw: metrics.avgScore },
              { icon: <Music2 className="w-3.5 h-3.5 text-primary" />, label: 'Avg Rounds', val: metrics.avgRounds != null ? String(metrics.avgRounds) : '—' },
              { icon: <BookOpen className="w-3.5 h-3.5 text-primary" />, label: 'Avg Reading', val: metrics.avgReading != null ? `${Math.floor(metrics.avgReading / 60).toString().padStart(2,'0')}:${Math.round(metrics.avgReading % 60).toString().padStart(2,'0')}` : '—' },
              { icon: <Headphones className="w-3.5 h-3.5 text-primary" />, label: 'Avg Hearing', val: metrics.avgHearing != null ? `${Math.floor(metrics.avgHearing / 60).toString().padStart(2,'0')}:${Math.round(metrics.avgHearing % 60).toString().padStart(2,'0')}` : (metrics.avgSb != null ? `${metrics.avgSb} pts` : '—') },
              { icon: <Moon className="w-3.5 h-3.5 text-indigo-500" />, label: residencyFilter !== 'non_resident' ? 'Avg Sleep' : 'Sleep Quality', val: metrics.avgSleepHrs != null ? `${metrics.avgSleepHrs} hrs` : (metrics.avgSleepQ != null ? `${metrics.avgSleepQ} pts` : '—') },
            ].map((m, i) => (
              <Card key={i} className="border-0 shadow-none bg-muted/30">
                <CardContent className="px-3 py-2">
                  <div className="flex items-center gap-1 mb-0.5">{m.icon}<span className="text-[11px] text-muted-foreground">{m.label}</span></div>
                  <div className={`text-lg font-bold ${m.colored ? scoreColor(m.raw, residencyFilter === 'resident') : 'text-foreground'}`}>{m.val}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* User scores table */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">User Breakdown</p>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/50 text-left">
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground w-6">#</th>
                    <th className="px-3 py-2">
                      <button className="text-xs font-medium text-muted-foreground hover:text-foreground uppercase tracking-wide" onClick={() => toggleSort('fullName')}>
                        Name <SortIcon col="fullName" />
                      </button>
                    </th>
                    <th className="px-3 py-2 hidden sm:table-cell text-xs font-medium text-muted-foreground uppercase tracking-wide">Residency</th>
                    <th className="px-3 py-2 hidden sm:table-cell text-xs font-medium text-muted-foreground uppercase tracking-wide">Ashraya</th>
                    <th className="px-3 py-2">
                      <button className="text-xs font-medium text-muted-foreground hover:text-foreground uppercase tracking-wide" onClick={() => toggleSort('scorePercent')}>
                        Score <SortIcon col="scorePercent" />
                      </button>
                    </th>
                    <th className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">🔥</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((u, i) => {
                    const residencyName = u.isResident
                      ? residencies.find(r => r.residencyId === u.residencyId)?.residencyName?.replace(/^FOLK\s+/i, '') || 'Resident'
                      : 'NR';
                    return (
                      <tr
                        key={u.userId}
                        className="border-t cursor-pointer hover:bg-muted/40 transition-colors"
                        onClick={() => navigate(`/guide/users/${u.userId}`)}
                      >
                        <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-3 py-2 font-medium">{u.fullName}</td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <Badge variant={u.isResident ? 'default' : 'secondary'} className="text-xs">{residencyName}</Badge>
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell text-xs text-muted-foreground">
                          {u.ashrayLevel || '—'}
                        </td>
                        <td className="px-3 py-2">
                          {u.submitted ? (
                            <span className={`font-bold ${scoreColor(u.scorePercent, u.isResident)}`}>
                              {u.scorePercent != null ? `${u.scorePercent}%` : '—'}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Not submitted</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {(u.currentStreak ?? 0) > 0
                            ? <span className="text-orange-600 font-semibold">{u.currentStreak}🔥</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">
                        No users for current filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
