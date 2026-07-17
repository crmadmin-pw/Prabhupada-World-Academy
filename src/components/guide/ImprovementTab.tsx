/**
 * ImprovementTab — plain-language guide to help non-technical guides understand
 * where the group is losing points and exactly what to do about it.
 *
 * Section A: Member-level field loss (which practices are suffering)
 * Section B: Individual members below target
 * Section C: Action Plan — specific, readable next steps with exact point breakdown
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGuideDetailedReport, GetGuideDetailedReportOutputType } from 'zite-endpoints-sdk';
import { format, startOfISOWeek, endOfISOWeek, subWeeks, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingDown, Users, RefreshCw, ChevronRight, Lightbulb, CheckCircle2, CheckCircle, ArrowUpRight } from 'lucide-react';
import { scoreColor } from '@/lib/scoring';

type ReportUser = GetGuideDetailedReportOutputType['users'][0];
type FieldDef = GetGuideDetailedReportOutputType['fieldDefs'][0];
type ResidencyFilter = 'resident' | 'non_resident' | 'all' | 'scholar';
// Removed 'this_week' — incomplete data. Options: prev_week, prev_month, this_month
type Period = 'prev_week' | 'prev_month' | 'this_month';

// ─── Rounding helper ─────────────────────────────────────────────────────────
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Sick/OS scored field keys — only these count toward score for sick/OS entries ───
// Residents: only chanting rounds, SP reading, and report_sending are scored
const RESIDENT_SICK_OS_KEYS = new Set([
  'rounds', 'sp_reading', 'sp_reading_minutes', 'report_sending', 'rounds_count',
]);
// NR: only chanting and reading are scored
const NR_SICK_OS_KEYS = new Set([
  'chanting', 'reading', 'fillingSameDay',
]);

/** Returns true if this field is scored for the given user when they are Sick/OS */
function isFieldScoredForSickOs(fieldKey: string, isResident: boolean): boolean {
  return isResident ? RESIDENT_SICK_OS_KEYS.has(fieldKey) : NR_SICK_OS_KEYS.has(fieldKey);
}

// ─── Plain language mappings ────────────────────────────────────────────────

const FIELD_PLAIN: Record<string, string> = {
  ma_na_gv:       'Morning Aarti & GV',
  quotes_tulasi:  'Quotes and Tulsi Prayers',
  japa_visible:   'Japa (done visibly in TH)',
  sb:             'SB Class Attendance',
  cleanliness:    'Cleanliness Duty',
  report_sending: 'Same-Day Form Filling',
  daily_service:  'Daily Service',
  rounds:         'Chanting 16 Rounds',
  sp_reading:     'Srila Prabhupada Reading',
  sleep_quality:  'Sleep Discipline',
  chanting:       'Chanting Rounds',
  reading:        'Book Reading',
  hearing:        'Hearing Lectures',
  fillingSameDay: 'Same-Day Form Filling',
  seva:           'Seva Participation',
  bhaktiVriksha:  'BhaktiVriksha Attendance',
};

const FIELD_TIP: Record<string, string> = {
  ma_na_gv:       'Encourage daily attendance at Mangal Aarti and GV. A group reminder the night before helps.',
  quotes_tulasi:  'Remind members to participate in quote and Tulasi devi pooja daily.',
  japa_visible:   'Ask members to chant their rounds in the temple hall, in front of the Deities — not in their room.',
  sb:             'Motivate members to attend Srimad Bhagavatam class every morning without exception.',
  cleanliness:    'Verify that members are completing their assigned cleaning duties each day.',
  report_sending: 'Ask members to fill the sadhana form before midnight on the same day, not the next morning.',
  daily_service:  'Check that every member is showing up for their allocated daily service slot.',
  rounds:         'Remind members to complete all 16 rounds before noon. Morning accountability helps.',
  sp_reading:     'Encourage at least 30 minutes of Srila Prabhupada book reading daily.',
  sleep_quality:  'Advise members to follow the scheduled sleep and wake-up times strictly.',
  chanting:       'Encourage completing all chanting rounds every single day without skipping.',
  reading:        'Encourage at least 30 minutes of Srila Prabhupada book reading daily.',
  hearing:        'Motivate members to listen to at least one lecture each day.',
  fillingSameDay: 'Ask members to fill the sadhana form on the same day it is due.',
};

function plainName(key: string, fallback: string): string {
  return FIELD_PLAIN[key] || fallback;
}
function guideTip(key: string): string {
  return FIELD_TIP[key] || 'Speak individually with members about this area.';
}

// ─── Period helpers ──────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  'prev_week':  'Previous Week',
  'prev_month': 'Previous Month',
  'this_month': 'This Month',
};

function getPeriodDates(period: Period): { start: string; end: string; reportType: 'weekly' | 'monthly' } {
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  if (period === 'prev_week') {
    // Full Mon–Sun of last week
    const lastWeek = subWeeks(today, 1);
    const mon = startOfISOWeek(lastWeek);
    const sun = endOfISOWeek(lastWeek);
    return { start: format(mon, 'yyyy-MM-dd'), end: format(sun, 'yyyy-MM-dd'), reportType: 'weekly' };
  }
  if (period === 'prev_month') {
    // Full previous calendar month
    const lastMonth = subMonths(today, 1);
    return {
      start: format(startOfMonth(lastMonth), 'yyyy-MM-dd'),
      end: format(endOfMonth(lastMonth), 'yyyy-MM-dd'),
      reportType: 'monthly',
    };
  }
  // this_month: 1st of current month → today
  return {
    start: format(startOfMonth(today), 'yyyy-MM-dd'),
    end: todayStr,
    reportType: 'monthly',
  };
}

// ─── Data computations ───────────────────────────────────────────────────────

interface FieldLossRow {
  key: string; plainName: string; maxPoints: number;
  avgScored: number; totalLost: number; count: number; fullMarkCount: number;
  lostCount: number;
}

/**
 * Returns ALL scoring fields sorted by total points lost (descending).
 * Sick/OS entries are excluded from fields that are not scored during sick/OS,
 * preventing their forced-zero scores from dragging down unrelated averages.
 */
function computeFieldLoss(users: ReportUser[], fieldDefs: FieldDef[], filter: ResidencyFilter): FieldLossRow[] {
  const submitted = users.filter(u => u.submitted);
  if (submitted.length === 0) return [];
  const rows: FieldLossRow[] = [];
  for (const d of fieldDefs.filter(d => d.isScoring && d.maxPoints != null && d.maxPoints > 0)) {
    const applicable = submitted.filter(u => {
      // Basic residency applicability
      // Scholars use resident template — treat like residents for field applicability
      const effectiveIsResident = u.isResident || !!(u as any).isTempResident;
      if (filter === 'scholar'      && !((u as any).isTempResident && d.forResident)) return false;
      if (filter === 'resident'     && !(effectiveIsResident && d.forResident)) return false;
      if (filter === 'non_resident' && !((!u.isResident) && d.forNR)) return false;
      if (filter === 'all') {
        if (u.isResident && !d.forResident) return false;
        if (!u.isResident && !d.forNR) return false;
      }
      // Sick/OS exclusion: if the user is sick/OS, only include them for fields
      // that are actually scored during sick/OS — otherwise their forced-zero
      // would incorrectly drag down the average for non-applicable fields.
      if (u.flagSick || u.flagOs) {
        if (!isFieldScoredForSickOs(d.key, u.isResident)) return false;
      }
      return true;
    });
    if (applicable.length === 0) continue;
    const scores = applicable.map(u => { const v = u.fieldScores[d.key]; return typeof v === 'number' ? v : 0; });
    const totalScored   = scores.reduce((a, b) => a + b, 0);
    const totalPossible = d.maxPoints! * applicable.length;
    const totalLost     = r2(totalPossible - totalScored);
    const lostCount     = scores.filter(s => s < d.maxPoints!).length;
    rows.push({
      key: d.key,
      plainName: plainName(d.key, d.shortLabel),
      maxPoints: d.maxPoints!,
      avgScored: r2(totalScored / applicable.length),
      totalLost,
      count: applicable.length,
      fullMarkCount: scores.filter(s => s >= d.maxPoints!).length,
      lostCount,
    });
  }
  return rows.sort((a, b) => {
    if (b.totalLost !== a.totalLost) return b.totalLost - a.totalLost;
    return a.plainName.localeCompare(b.plainName);
  });
}

interface WeakField {
  key: string; plainName: string; scored: number; maxPoints: number; lost: number;
}

interface LowScorer extends ReportUser {
  weakest: WeakField[];
  allLostFields: WeakField[];
  maxPossible: number;
  ptsNeededForTarget: number;
  targetPlan: { field: WeakField; gainedSoFar: number; cumulativePct: number }[];
}

function computeLowScorers(users: ReportUser[], fieldDefs: FieldDef[], filter: ResidencyFilter): LowScorer[] {
  const submitted = users.filter(u => u.submitted);
  const scoring = fieldDefs.filter(d => d.isScoring && d.maxPoints != null && d.maxPoints > 0);
  return submitted
    .filter(u => (u.scorePercent ?? 0) < ((u.isResident || !!(u as any).isTempResident) ? 95 : 75))
    .sort((a, b) => (a.scorePercent ?? 0) - (b.scorePercent ?? 0))
    .map(u => {
      // For sick/OS users, only include fields that are actually scored for them
      const applicable = scoring.filter(d => {
        const effectiveIsResident = u.isResident || !!(u as any).isTempResident;
        const isApplicable = effectiveIsResident ? d.forResident : d.forNR;
        if (!isApplicable) return false;
        // Exclude non-scored fields for sick/OS entries
        if ((u.flagSick || u.flagOs) && !isFieldScoredForSickOs(d.key, u.isResident)) return false;
        return true;
      });
      const maxPossible = applicable.reduce((s, d) => s + d.maxPoints!, 0);
      const allLostFields: WeakField[] = applicable
        .map(d => {
          const scored = typeof u.fieldScores[d.key] === 'number' ? u.fieldScores[d.key] as number : 0;
          return { key: d.key, plainName: plainName(d.key, d.shortLabel), scored, maxPoints: d.maxPoints!, lost: r2(d.maxPoints! - scored) };
        })
        .filter(f => f.lost > 0)
        .sort((a, b) => b.lost - a.lost);

      const weakest = allLostFields.slice(0, 3);
      const threshold = u.isResident ? 95 : 75;
      const currentPct = r2(u.scorePercent ?? 0);
      const ptsNeededForTarget = maxPossible > 0
        ? r2(Math.max(0, (threshold / 100) * maxPossible - (currentPct / 100) * maxPossible))
        : 0;

      let gainedSoFar = 0;
      const targetPlan: LowScorer['targetPlan'] = [];
      for (const field of allLostFields) {
        if (gainedSoFar >= ptsNeededForTarget) break;
        gainedSoFar = r2(gainedSoFar + field.lost);
        const newScore = r2((currentPct / 100) * maxPossible + gainedSoFar);
        const cumulativePct = maxPossible > 0 ? r2((newScore / maxPossible) * 100) : currentPct;
        targetPlan.push({ field, gainedSoFar, cumulativePct: Math.min(100, cumulativePct) });
      }

      return { ...u, weakest, allLostFields, maxPossible, ptsNeededForTarget, targetPlan };
    });
}

// ─── Action Plan ─────────────────────────────────────────────────────────────

interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  type: 'group' | 'individual';
  emoji: string;
  title: string;
  detail: string;
  tip: string;
  targetPlan?: LowScorer['targetPlan'];
  targetPct?: number;
  currentPct?: number;
  fieldRow?: FieldLossRow; // for group items — allows opening the members dialog
}

function buildActionPlan(fieldLoss: FieldLossRow[], lowScorers: LowScorer[], targetLabel: string): ActionItem[] {
  const items: ActionItem[] = [];
  fieldLoss.filter(f => f.totalLost > 0).slice(0, 3).forEach((f, i) => {
    const pctAffected = f.count > 0 ? Math.round((f.lostCount / f.count) * 100) : 0;
    const priority: ActionItem['priority'] = i === 0 ? 'high' : i === 1 ? 'medium' : 'low';
    items.push({
      priority,
      type: 'group',
      emoji: priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢',
      title: f.plainName,
      detail: `${f.lostCount} out of ${f.count} ${f.lostCount === 1 ? 'member is' : 'members are'} losing points here (${pctAffected}% of your members). Members' avg: ${f.avgScored} out of ${f.maxPoints} pts. Total pts lost this period: ${f.totalLost}.`,
      tip: guideTip(f.key),
      fieldRow: f,
    });
  });
  lowScorers.slice(0, 5).forEach(u => {
    const pct = r2(u.scorePercent ?? 0);
    const threshold = u.isResident ? 95 : 75;
    const gap = r2(threshold - pct);
    const priority: ActionItem['priority'] = gap > 20 ? 'high' : 'medium';
    items.push({
      priority,
      type: 'individual',
      emoji: gap > 20 ? '🔴' : '🟡',
      title: u.fullName,
      detail: `Currently at ${pct}% — target is ${targetLabel}. Needs ${gap}% more (approx. ${u.ptsNeededForTarget} pts).`,
      tip: `Improve these specific areas to reach ${targetLabel}:`,
      targetPlan: u.targetPlan,
      targetPct: threshold,
      currentPct: pct,
    });
  });
  return items;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { guideId: string; bvslMode?: boolean; mentorMode?: boolean; }

export default function ImprovementTab({ guideId, bvslMode, mentorMode }: Props) {
  const navigate = useNavigate();
  // Default to previous week — current week is always incomplete
  const [period, setPeriod] = useState<Period>('prev_week');
  const [residencyFilter, setResidencyFilter] = useState<ResidencyFilter>('resident');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<GetGuideDetailedReportOutputType | null>(null);
  // Dialog for "who lost points on this field"
  const [fieldDialog, setFieldDialog] = useState<FieldLossRow | null>(null);

  const load = () => {
    const { start, end, reportType } = getPeriodDates(period);
    setLoading(true);
    getGuideDetailedReport({ guideId, date: end, reportType, startDate: start, endDate: end, bvslMode, mentorMode })
      .then(res => setData(res as any))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [guideId, period, bvslMode, mentorMode]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    return data.users.filter(u => {
      const isScholar = !!(u as any).isTempResident;
      if (residencyFilter === 'scholar') return isScholar;
      // Scholars excluded from non-scholar views
      if (isScholar) return false;
      if (residencyFilter === 'resident')     return u.isResident;
      if (residencyFilter === 'non_resident') return !u.isResident;
      return true;
    });
  }, [data, residencyFilter]);

  const fieldDefs       = data?.fieldDefs ?? [];
  const fieldLoss       = useMemo(() => computeFieldLoss(filteredUsers, fieldDefs, residencyFilter), [filteredUsers, fieldDefs, residencyFilter]);
  const lowScorers      = useMemo(() => computeLowScorers(filteredUsers, fieldDefs, residencyFilter), [filteredUsers, fieldDefs, residencyFilter]);
  const submittedCount  = filteredUsers.filter(u => u.submitted).length;
  const totalCount      = filteredUsers.length;
  const targetLabel     = residencyFilter === 'non_resident' ? '75%' : '95%'; // scholars use 95% (resident template)
  const actionPlan      = useMemo(() => buildActionPlan(fieldLoss, lowScorers, targetLabel), [fieldLoss, lowScorers, targetLabel]);

  const fieldsWithLoss  = fieldLoss.filter(f => f.totalLost > 0);
  const fieldsFullMarks = fieldLoss.filter(f => f.totalLost === 0);

  const { start: pStart, end: pEnd } = getPeriodDates(period);
  const periodRangeLabel = pStart === pEnd ? pStart : `${pStart} → ${pEnd}`;

  return (
    <>
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
            <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
              {(['resident', 'non_resident', 'all', 'scholar'] as const).map(val => (
                <button key={val} onClick={() => setResidencyFilter(val)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${residencyFilter === val ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {val === 'all' ? 'All' : val === 'resident' ? 'Residents' : val === 'non_resident' ? 'Non-Residents' : 'Scholars'}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground hidden sm:block">{periodRangeLabel}</span>
              <span className="text-xs text-muted-foreground">{submittedCount}/{totalCount} submitted</span>
              <button onClick={load} disabled={loading}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : submittedCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="text-sm">No submitted entries in this period. Try a different date range.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">

          {/* Section A + B — side by side on desktop */}
          <div className="order-last grid gap-4 lg:grid-cols-2">

            {/* ── A: Member Field Loss ─────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingDown className="w-4 h-4 text-destructive" />
                  Where Are Your Members Losing Points?
                </CardTitle>
                <CardDescription className="text-xs">
                  All scoring practices ranked from most points lost to least — across {submittedCount} submitted members (sick/OS entries excluded from fields not scored for them).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {fieldLoss.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="font-semibold text-sm text-green-600">Everyone is scoring full marks!</p>
                    <p className="text-xs text-muted-foreground mt-1">Your members are doing great — keep it up 🙏</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fieldsWithLoss.map((f, i) => {
                      const fillPct = f.maxPoints > 0 ? (f.avgScored / f.maxPoints) * 100 : 0;
                      const bgClass = i === 0 ? 'bg-destructive/8 border-destructive/25'
                        : i === 1 ? 'bg-orange-50 border-orange-200'
                        : i <= 3 ? 'bg-amber-50 border-amber-200'
                        : 'bg-muted/40 border-border';
                      const barClass = i === 0 ? 'bg-destructive' : i === 1 ? 'bg-orange-500' : i <= 3 ? 'bg-amber-500' : 'bg-muted-foreground/50';
                      const textClass = i === 0 ? 'text-destructive' : i === 1 ? 'text-orange-700' : 'text-amber-700';
                      return (
                        <div key={f.key} className={`p-3 rounded-lg border ${bgClass}`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className={`text-base font-black shrink-0 leading-tight ${textClass}`}>{i + 1}.</span>
                              <div className="min-w-0">
                                <p className="font-semibold text-sm leading-tight">{f.plainName}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  <button
                                    onClick={() => setFieldDialog(f)}
                                    className={`underline underline-offset-2 cursor-pointer font-medium hover:opacity-70 transition-opacity ${textClass}`}
                                  >
                                    {f.lostCount} out of {f.count} {f.lostCount === 1 ? 'member' : 'members'} lost points
                                  </button>
                                  {' · '}<span className={`font-medium ${textClass}`}>{f.totalLost} pts lost total</span>
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={`text-sm font-bold ${textClass}`}>{f.avgScored}<span className="text-xs font-normal text-muted-foreground">/{f.maxPoints}</span></p>
                              <p className="text-[10px] text-muted-foreground">members' avg</p>
                            </div>
                          </div>
                          <div className="h-2 bg-background/70 rounded-full overflow-hidden">
                            <div className={`h-full ${barClass} rounded-full transition-all`} style={{ width: `${fillPct}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                            <span>{f.fullMarkCount === 0 ? 'Nobody scored full marks' : `${f.fullMarkCount} scored full marks`}</span>
                            <span>{Math.round(fillPct)}% of max</span>
                          </div>
                        </div>
                      );
                    })}

                    {fieldsFullMarks.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-green-600" /> No points lost in these areas
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {fieldsFullMarks.map(f => (
                            <div key={f.key} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-green-50 border border-green-200">
                              <CheckCircle className="w-3 h-3 text-green-600 shrink-0" />
                              <span className="text-xs font-medium text-green-800 truncate">{f.plainName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── B: Who Needs Help ────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-amber-600" />
                  Who Needs Personal Attention?
                  {lowScorers.length > 0 && (
                    <Badge variant="outline" className="text-xs text-amber-700 border-amber-400 ml-1">
                      {lowScorers.length} below {targetLabel}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs">
                  Members below the {targetLabel} target — tap a name to see their full sadhana history
                </CardDescription>
              </CardHeader>
              <CardContent>
                {lowScorers.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-2xl mb-2">🎉</p>
                    <p className="font-semibold text-sm text-green-600">All {submittedCount} members are at {targetLabel}+!</p>
                    <p className="text-xs text-muted-foreground mt-1">Excellent discipline — keep it up 🙏</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {lowScorers.map(u => {
                      const threshold = u.isResident ? 95 : 75;
                      const pct = r2(u.scorePercent ?? 0);
                      const gap = r2(threshold - pct);
                      const urgent = pct < threshold - 15;
                      return (
                        <div
                          key={u.id}
                          className={`p-3 rounded-lg border cursor-pointer hover:bg-muted/40 transition-colors ${urgent ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-amber-400'}`}
                          onClick={() => navigate(`/guide/users/${u.userId}`)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-sm truncate mb-1.5">{u.fullName}</p>
                              <div className="flex flex-wrap gap-1">
                                {u.weakest.map(f => (
                                  <span key={f.key} className="text-xs bg-destructive/8 text-destructive border border-destructive/20 rounded px-1.5 py-0.5 leading-tight">
                                    {f.plainName}: {r2(f.scored)}/{f.maxPoints}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="text-right shrink-0 flex items-center gap-1">
                              <div>
                                <div className={`text-base font-bold ${scoreColor(pct, u.isResident)}`}>{pct}%</div>
                                <div className="text-xs text-muted-foreground">needs +{gap}%</div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground pt-1 text-center border-t">
                      Tap any member to view their detailed history
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── C: Action Plan — shown first ──────────────────────────────── */}
          {actionPlan.length > 0 && (
            <Card className="order-first">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Lightbulb className="w-4 h-4 text-yellow-500" />
                  What Should You Do Now? — Action Plan
                </CardTitle>
                <CardDescription className="text-xs">
                  Specific steps based on the data above — targets {residencyFilter === 'non_resident' ? '≥75% for non-residents' : '≥95% for scholars/residents'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {actionPlan.map((item, i) => (
                    <div key={i} className={`p-3.5 rounded-lg border ${
                      item.priority === 'high'
                        ? 'border-destructive/30 bg-destructive/5'
                        : item.priority === 'medium'
                        ? 'border-amber-300/50 bg-amber-50/40'
                        : 'border-border bg-muted/30'
                    }`}>
                      <div className="flex items-start gap-2.5">
                        <span className="text-lg shrink-0 leading-tight">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                            <p className="font-bold text-sm">{item.title}</p>
                            <Badge variant="outline" className={`text-xs shrink-0 ${
                              item.type === 'group'
                                ? 'border-primary/40 text-primary'
                                : 'border-amber-500/40 text-amber-700'
                            }`}>
                              {item.type === 'group' ? '👥 All members' : '👤 Individual'}
                            </Badge>
                            <span className={`text-xs font-semibold shrink-0 ${
                              item.priority === 'high' ? 'text-destructive' : item.priority === 'medium' ? 'text-amber-600' : 'text-muted-foreground'
                            }`}>
                              {item.priority === 'high' ? '— Urgent' : item.priority === 'medium' ? '— Attention needed' : '— Keep an eye'}
                            </span>
                          </div>
                          {item.type === 'group' && item.fieldRow ? (
                            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                              <button
                                onClick={() => setFieldDialog(item.fieldRow!)}
                                className="underline underline-offset-2 cursor-pointer hover:opacity-70 transition-opacity"
                              >
                                {item.fieldRow.lostCount} out of {item.fieldRow.count} {item.fieldRow.lostCount === 1 ? 'member is' : 'members are'} losing points
                              </button>
                              {` (${Math.round((item.fieldRow.lostCount / item.fieldRow.count) * 100)}% of your members). Members' avg: ${item.fieldRow.avgScored} out of ${item.fieldRow.maxPoints} pts. Total pts lost this period: ${item.fieldRow.totalLost}.`}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">{item.detail}</p>
                          )}

                          {item.type === 'group' && (
                            <div className="flex items-start gap-2 bg-background rounded-md px-2.5 py-2 border border-border/60">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                              <p className="text-xs font-medium leading-relaxed">{item.tip}</p>
                            </div>
                          )}

                          {item.type === 'individual' && item.targetPlan && item.targetPlan.length > 0 && (
                            <div className="bg-background rounded-md border border-border/60 overflow-hidden">
                              <div className="px-2.5 py-1.5 border-b border-border/40 flex items-center gap-1.5">
                                <ArrowUpRight className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                <p className="text-xs font-semibold text-foreground">{item.tip}</p>
                              </div>
                              <div className="divide-y divide-border/40">
                                {item.targetPlan.map(({ field, gainedSoFar, cumulativePct }, idx) => {
                                  const reachedTarget = cumulativePct >= (item.targetPct ?? 95);
                                  return (
                                    <div key={field.key} className={`flex items-center gap-2 px-2.5 py-2 ${reachedTarget ? 'bg-green-50/60' : ''}`}>
                                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-muted text-muted-foreground shrink-0">{idx + 1}</span>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium truncate">{field.plainName}</p>
                                        <p className="text-[10px] text-muted-foreground">
                                          Currently {r2(field.scored)}/{field.maxPoints} pts — gain +{field.lost} pts
                                        </p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className={`text-xs font-bold ${reachedTarget ? 'text-green-600' : 'text-amber-600'}`}>
                                          → {cumulativePct}%
                                        </p>
                                        {reachedTarget && (
                                          <p className="text-[10px] text-green-600 font-medium">✓ Target reached</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {item.targetPlan.length > 0 && item.targetPlan[item.targetPlan.length - 1].cumulativePct < (item.targetPct ?? 95) && (
                                <div className="px-2.5 py-1.5 bg-muted/40 border-t border-border/40">
                                  <p className="text-[10px] text-muted-foreground">
                                    Fixing all above areas still may not reach {item.targetPct}% — consistency over more days is needed.
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {item.type === 'individual' && (!item.targetPlan || item.targetPlan.length === 0) && (
                            <div className="flex items-start gap-2 bg-background rounded-md px-2.5 py-2 border border-border/60">
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                              <p className="text-xs font-medium leading-relaxed">
                                This member needs consistent daily entries to improve their average. Encourage them to submit every day.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground text-center pt-3 border-t mt-3">
                  These suggestions update automatically whenever you refresh the data above
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>

    {/* ── Field Members Lost Dialog ─────────────────────────────── */}
    <Dialog open={!!fieldDialog} onOpenChange={open => { if (!open) setFieldDialog(null); }}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-destructive shrink-0" />
            {fieldDialog?.plainName} — Members Who Lost Points
          </DialogTitle>
        </DialogHeader>
        {fieldDialog && (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground pb-1 border-b">
              {fieldDialog.lostCount} of {fieldDialog.count} members scored below {fieldDialog.maxPoints} pts
              {' '}&nbsp;·&nbsp; avg {fieldDialog.avgScored}/{fieldDialog.maxPoints}
            </p>
            {filteredUsers
              .filter(u => u.submitted)
              .filter(u => {
                const score = typeof u.fieldScores[fieldDialog.key] === 'number'
                  ? (u.fieldScores[fieldDialog.key] as number)
                  : null;
                return score !== null && score < fieldDialog.maxPoints;
              })
              .sort((a, b) => {
                const sa = typeof a.fieldScores[fieldDialog.key] === 'number' ? (a.fieldScores[fieldDialog.key] as number) : 0;
                const sb = typeof b.fieldScores[fieldDialog.key] === 'number' ? (b.fieldScores[fieldDialog.key] as number) : 0;
                return sa - sb;
              })
              .map(u => {
                const score = u.fieldScores[fieldDialog.key] as number;
                const lost = r2(fieldDialog.maxPoints - score);
                const pct = fieldDialog.maxPoints > 0 ? Math.round((score / fieldDialog.maxPoints) * 100) : 0;
                return (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border bg-muted/30 cursor-pointer hover:bg-muted/60 transition-colors"
                    onClick={() => { setFieldDialog(null); navigate(`/guide/users/${u.userId}`); }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{u.fullName}</p>
                      {u.ashrayLevel && (
                        <p className="text-xs text-muted-foreground">{u.ashrayLevel}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${scoreColor(pct, u.isResident)}`}>
                        {r2(score)}<span className="text-xs font-normal text-muted-foreground">/{fieldDialog.maxPoints}</span>
                      </p>
                      <p className="text-[10px] text-destructive font-medium">−{lost} pts</p>
                    </div>
                  </div>
                );
              })}
            {filteredUsers.filter(u => u.submitted && typeof u.fieldScores[fieldDialog.key] === 'number' && (u.fieldScores[fieldDialog.key] as number) >= fieldDialog.maxPoints).length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-green-600" /> Full marks — {filteredUsers.filter(u => u.submitted && (u.fieldScores[fieldDialog.key] as number) >= fieldDialog.maxPoints).length} members
                </p>
                <div className="flex flex-wrap gap-1">
                  {filteredUsers
                    .filter(u => u.submitted && typeof u.fieldScores[fieldDialog.key] === 'number' && (u.fieldScores[fieldDialog.key] as number) >= fieldDialog.maxPoints)
                    .map(u => (
                      <span key={u.id} className="text-xs bg-green-50 border border-green-200 text-green-800 rounded px-2 py-0.5">
                        {u.fullName}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
