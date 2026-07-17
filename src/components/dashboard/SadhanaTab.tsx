import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { FileText, TrendingUp, Flame, Edit, Plus, Target, ArrowRight, GraduationCap } from 'lucide-react';
import FieldTrendChart, { RESIDENT_FIELD_CONFIGS, NR_FIELD_CONFIGS } from '@/components/stats/FieldTrendChart';
import { format } from 'date-fns';
import SectionErrorBoundary from '@/components/SectionErrorBoundary';
import MiniCalendar from '@/components/dashboard/MiniCalendar';
import EntryDetailModal from '@/components/dashboard/EntryDetailModal';
import { getUserProgressStats } from 'zite-endpoints-sdk';
import GuideOneToOneCard from '@/components/dashboard/GuideOneToOneCard';
import PersonalServiceAlert from '@/components/services/PersonalServiceAlert';

interface Metrics {
  todayScore: number | null; todayPercent: number | null; todaySubmitted: boolean;
  currentStreak: number; weeklyAverage: number; weeklyAveragePercent: number | null;
  weeklySubmissionRate: number; entriesThisWeek?: number; weekNumber?: number;
  weekStartDate?: string | null; weekEndDate?: string | null; streakAtRisk?: boolean;
  entriesLast7Days?: number;
}
interface HistoryEntry {
  entryId: string; entryDate: string; totalScore: number;
  scorePercent: number | null; submittedAt: string; flagSick: boolean; flagOs: boolean;
}
interface Props {
  metrics: Metrics; history: HistoryEntry[];
  userId: string;
  residencyId?: string;
}

type Period = 'daily' | 'weekly' | 'monthly';
const TREND_PERIOD_LABELS: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

// Insight period — entry-count based (not calendar date range)
const INSIGHT_PERIOD_OPTIONS: { value: Period; label: string; shortDesc: string }[] = [
  { value: 'daily',   label: 'Yesterday',        shortDesc: 'yesterday\'s entry' },
  { value: 'weekly',  label: 'Last 7 Entries',   shortDesc: 'your last 7 entries' },
  { value: 'monthly', label: 'Last 30 Entries',  shortDesc: 'your last 30 entries' },
];

function formatSubmittedAt(submittedAt: string): string {
  if (!submittedAt) return '';
  try { return format(new Date(submittedAt), 'MMM dd, yyyy · h:mm a'); } catch { return ''; }
}

function safeDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr.length < 8) return null;
  try {
    const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function formatWeekLabel(m: Metrics): string {
  const wk = m.weekNumber ?? 0;
  const start = m.weekStartDate;
  const end = m.weekEndDate;
  if (start && end) {
    try {
      const sd = safeDate(start);
      const ed = safeDate(end);
      if (sd && ed) return `Week ${wk}: ${format(sd, 'MMM dd')} – ${format(ed, 'MMM dd')}`;
    } catch {}
  }
  return wk ? `Week ${wk}` : 'This Week';
}

interface InsightField {
  key: string; label: string; maxPts: number; tip: string;
  avgPts: number; potentialGain: number; entriesUsed?: number;
}

interface ImprovementInsightsProps {
  insights: InsightField[];
  isResident: boolean;
  isScholar: boolean;
  period: Period;
  onPeriodChange: (p: Period) => void;
  loading: boolean;
  insightData?: any;
}

function ImprovementInsights({ insights, isResident, isScholar, period, onPeriodChange, loading, insightData }: ImprovementInsightsProps) {
  const targetPct = isResident ? 95 : 75;
  const totalGain = insights.reduce((sum, f) => sum + f.potentialGain, 0);
  const periodOpt = INSIGHT_PERIOD_OPTIONS.find(o => o.value === period) ?? INSIGHT_PERIOD_OPTIONS[0];
  const insightEntryCount = insightData?.insightEntryCount ?? 0;
  const noEntry = insightData?.noEntry ?? false;

  // Build context label
  let contextLabel = '';
  if (period === 'daily') {
    contextLabel = noEntry ? 'No entry for yesterday' : 'Based on yesterday\'s entry';
  } else {
    contextLabel = insightEntryCount > 0
      ? `Based on your last ${insightEntryCount} ${insightEntryCount === 1 ? 'entry' : 'entries'}`
      : `Based on ${periodOpt.shortDesc}`;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Target className="w-4 h-4 text-primary" />
              Areas of Improvement
            </CardTitle>
            {isScholar && (
              <Badge variant="outline" className="text-xs gap-1 border-indigo-400 text-indigo-600">
                <GraduationCap className="w-3 h-3" />Scholar
              </Badge>
            )}
            {isResident && !isScholar && (
              <Badge variant="outline" className="text-xs border-primary/40 text-primary">Resident · {targetPct}% target</Badge>
            )}
            {!isResident && (
              <Badge variant="outline" className="text-xs border-muted-foreground/40 text-muted-foreground">NR · {targetPct}% target</Badge>
            )}
          </div>
          <div className="flex gap-0.5 bg-muted rounded-lg p-0.5">
            {INSIGHT_PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => onPeriodChange(opt.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === opt.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs">
          {contextLabel} · Ranked by biggest score gap — focus on top areas to reach {targetPct}%+
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : noEntry && period === 'daily' ? (
          <div className="flex items-start gap-3 py-2">
            <span className="text-2xl shrink-0">📋</span>
            <div>
              <p className="font-semibold text-sm">No entry for yesterday.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Submit yesterday's sadhana to see which fields to focus on.
                Try switching to <strong>Last 7 Entries</strong> to see insights from recent data.
              </p>
            </div>
          </div>
        ) : insightEntryCount === 0 && period !== 'daily' ? (
          <div className="flex items-start gap-3 py-2">
            <span className="text-2xl shrink-0">📋</span>
            <div>
              <p className="font-semibold text-sm">No entries found.</p>
              <p className="text-xs text-muted-foreground mt-0.5">Start submitting your daily sadhana to see improvement insights.</p>
            </div>
          </div>
        ) : insights.length === 0 ? (
          <div className="flex items-start gap-3 py-2">
            <span className="text-2xl shrink-0">🎉</span>
            <div>
              <p className="font-semibold text-sm">Full marks{period === 'daily' ? ' yesterday' : ' in this period'}!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You scored {targetPct}%+ — excellent sadhana! Keep maintaining this consistency. 🙏
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {insights.map((f, i) => (
              <div key={f.key} className="flex items-start gap-3 py-2.5 border-b last:border-0">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                  i === 0 ? 'bg-primary text-primary-foreground' :
                  i === 1 ? 'bg-primary/70 text-primary-foreground' :
                  i === 2 ? 'bg-primary/50 text-primary-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-sm leading-snug">{f.label}</span>
                    <Badge variant="outline" className="text-xs text-destructive border-destructive/40 px-1.5 shrink-0 whitespace-nowrap">
                      −{f.potentialGain} pts
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full"
                        style={{ width: `${Math.min(100, (f.avgPts / f.maxPts) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      avg {f.avgPts}/{f.maxPts} pts
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                    <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{f.tip}</span>
                  </p>
                </div>
              </div>
            ))}
            {totalGain > 0 && (
              <p className="text-xs text-muted-foreground pt-2 text-center">
                💡 Improve all {insights.length} area{insights.length > 1 ? 's' : ''} → earn up to{' '}
                <span className="font-semibold text-foreground">+{Math.round(totalGain * 10) / 10} pts</span> per entry
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SadhanaTab({ metrics, history, userId, residencyId }: Props) {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);


  // Trend chart state (independent)
  const [trendPeriod, setTrendPeriod] = useState<Period>('daily');
  const [progressData, setProgressData] = useState<any>(null);
  const [progressLoading, setProgressLoading] = useState(false);

  // Insight section state (independent period selector, entry-count based)
  const [insightPeriod, setInsightPeriod] = useState<Period>('daily');
  const [insightData, setInsightData] = useState<any>(null);
  const [insightLoading, setInsightLoading] = useState(true);



  // Load trend chart data (date-range based)
  useEffect(() => {
    if (!userId) return;
    setProgressLoading(true);
    const days = trendPeriod === 'monthly' ? 365 : trendPeriod === 'weekly' ? 84 : 45;
    getUserProgressStats({ userId, days, period: trendPeriod })
      .then(res => setProgressData(res as any))
      .catch(() => {})
      .finally(() => setProgressLoading(false));
  }, [userId, trendPeriod]);

  // Load insight data — entry-count based (insightMode: true)
  useEffect(() => {
    if (!userId) return;
    setInsightLoading(true);
    getUserProgressStats({ userId, period: insightPeriod, insightMode: true })
      .then(res => setInsightData(res as any))
      .catch(() => {})
      .finally(() => setInsightLoading(false));
  }, [userId, insightPeriod]);

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayHistoryEntry = history.find(e => e.entryDate === todayStr);
  const submittedAtDisplay = todayHistoryEntry?.submittedAt ? formatSubmittedAt(todayHistoryEntry.submittedAt) : '';
  const entriesCount = metrics.entriesThisWeek ?? metrics.entriesLast7Days ?? 0;
  const daysApplicable = 7;
  const weekLabel = formatWeekLabel(metrics);

  const isResident = progressData?.isResident ?? insightData?.isResident ?? true;
  const isScholar = insightData?.isScholar ?? false;
  const fieldConfigs = isResident ? RESIDENT_FIELD_CONFIGS : NR_FIELD_CONFIGS;
  const trendEntries = progressData?.entries ?? [];

  return (
    <div className="space-y-6">
      {residencyId && <PersonalServiceAlert residencyId={residencyId} />}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Today's Score</CardTitle></CardHeader>
          <CardContent>
            {metrics.todaySubmitted ? (<>
              <div className="text-3xl font-bold text-primary">{metrics.todayPercent != null ? `${metrics.todayPercent}%` : metrics.todayScore}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {submittedAtDisplay ? `Submitted ${submittedAtDisplay}` : `Submitted on ${format(new Date(), 'MMM dd, yyyy')}`}
              </p>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => navigate('/sadhana')}><Edit className="w-4 h-4 mr-2" />Edit Entry</Button>
            </>) : (<>
              <div className="text-3xl font-bold text-muted-foreground">—</div>
              <p className="text-xs text-muted-foreground mt-1">Not submitted yet</p>
              <Button size="sm" className="mt-3 w-full" onClick={() => navigate('/sadhana')}><Plus className="w-4 h-4 mr-2" />Fill / Edit Sadhana Form</Button>
            </>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Current Streak</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2"><Flame className="w-8 h-8 text-orange-500" /><div className="text-3xl font-bold">{metrics.currentStreak}</div></div>
            <p className="text-xs text-muted-foreground mt-1">{metrics.currentStreak === 0 ? 'Start your streak today!' : `${metrics.currentStreak} consecutive day${metrics.currentStreak !== 1 ? 's' : ''}`}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Sadhana Score {isResident ? '≥ 95%' : '≥ 75%'}</p>
            {metrics.streakAtRisk && (
              <p className="text-xs text-orange-500 mt-1 font-medium">⚠️ Submit today to keep your streak!</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Weekly Average</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2"><TrendingUp className="w-6 h-6 text-primary" /><div className="text-3xl font-bold">{metrics.weeklyAveragePercent != null ? `${metrics.weeklyAveragePercent}%` : (metrics.weeklyAverage > 0 ? `${metrics.weeklyAverage} pts` : '—')}</div></div>
            <p className="text-xs text-muted-foreground mt-0.5">{weekLabel}</p>
            <p className="text-xs text-muted-foreground">{entriesCount} of {daysApplicable} days submitted</p>
          </CardContent>
        </Card>
      </div>

      <GuideOneToOneCard />

      <div className="grid gap-6 lg:grid-cols-2">
        <MiniCalendar entries={history} onDayClick={(date) => navigate(`/sadhana?date=${date}`)} isResident={isResident} />

        {/* Multi-field Trend Chart */}
        <Card>
          <CardHeader className="pb-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="w-4 h-4 text-primary" />Progress Trends
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Select field to see your progress
                </CardDescription>
              </div>
              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                {(Object.keys(TREND_PERIOD_LABELS) as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      trendPeriod === p
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {TREND_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pb-6">
            {history.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">No entries yet. Start by filling today's report!</p>
                <Button className="mt-4" size="sm" onClick={() => navigate('/sadhana')}>
                  <Plus className="w-4 h-4 mr-2" />Submit First Entry
                </Button>
              </div>
            ) : progressLoading ? (
              <div className="space-y-2">
                <div className="flex gap-2"><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-16" /><Skeleton className="h-6 w-16" /></div>
                <Skeleton className="h-[200px] w-full" />
              </div>
            ) : (
              <FieldTrendChart
                data={trendEntries}
                fieldConfigs={fieldConfigs}
                isResident={isResident}
                defaultSelected="scorePercent"
                height={210}
                showThreshold
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Areas of Improvement — entry-count based, independent period selector */}
      <ImprovementInsights
        insights={insightData?.insightFields ?? []}
        insightData={insightData}
        isResident={insightData?.isResident ?? isResident}
        isScholar={isScholar}
        period={insightPeriod}
        onPeriodChange={setInsightPeriod}
        loading={insightLoading}
      />

      <EntryDetailModal userId={userId} entryDate={selectedDate} onClose={() => setSelectedDate(null)} />
    </div>
  );
}
