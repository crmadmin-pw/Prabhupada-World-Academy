import { useEffect, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { subDays } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Flame, TrendingUp, MessageCircle, Phone, Leaf, Star, Calendar, BarChart3, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { toast } from 'sonner';
import { getUserDetailForGuide, getAshrayUpgradePath, getBvAttendance, getAshrayChecklist, getUserProgressStats, getUserCrmData } from 'zite-endpoints-sdk';
import type { GetAshrayUpgradePathOutputType, GetUserCrmDataOutputType } from 'zite-endpoints-sdk';
import AshrayJourneyCard from '@/components/crm/AshrayJourneyCard';
import TripsDuesCard from '@/components/crm/TripsDuesCard';
import RentHistoryCard from '@/components/crm/RentHistoryCard';
import { format } from 'date-fns';
import { fmt } from '@/lib/fmt';
import { normalizePhoneForLinks } from '@/lib/userUtils';
import AshrayCriteriaGrid from '@/components/profile/AshrayCriteriaGrid';
import AshrayLevelDropdown from '@/components/guide/AshrayLevelDropdown';
import MiniCalendar from '@/components/dashboard/MiniCalendar';
import EntryDetailModal from '@/components/dashboard/EntryDetailModal';
import FieldTrendChart, { RESIDENT_FIELD_CONFIGS, NR_FIELD_CONFIGS } from '@/components/stats/FieldTrendChart';

type Period = 'daily' | 'weekly' | 'monthly';
const PERIOD_LABELS: Record<Period, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

function isRequired(req: string): boolean {
  return !!req && req !== '-' && req !== '—';
}

export default function GuideUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user: viewerUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const viewerRole = viewerUser?.role || '';
  const canEditTrips = ['Guide', 'Super Guide'].includes(viewerRole) || !!((viewerUser as any)?.isTripCoordinator);
  const canEditRent = ['Guide', 'Super Guide'].includes(viewerRole) || !!((viewerUser as any)?.isFolkLead);

  const goBack = () => {
    const referrer = (location.state as any)?.from as string | undefined;
    if (referrer) { navigate(referrer); return; }
    navigate(-1);
  };

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [ashrayData, setAshrayData] = useState<GetAshrayUpgradePathOutputType | null>(null);
  const [bvData, setBvData] = useState<any>(null);
  const [checklistData, setChecklistData] = useState<any>(null);
  const [progressStats, setProgressStats] = useState<any>(null);
  const [selectedEntryDate, setSelectedEntryDate] = useState<string | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<Period>('daily');
  const [trendLoading, setTrendLoading] = useState(false);
  const [crmData, setCrmData] = useState<GetUserCrmDataOutputType | null>(null);

  useEffect(() => { if (userId) loadUserDetail(); }, [userId]);

  const loadUserDetail = async () => {
    if (!userId) return;
    try {
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const [result, ashrayRes, bvRes, checklistRes, progressRes, crmRes] = await Promise.all([
        getUserDetailForGuide({ userId }),
        getAshrayUpgradePath({}),
        getBvAttendance({ userId, localDate }).catch(() => null),
        getAshrayChecklist({ userId }).catch(() => null),
        getUserProgressStats({ userId, days: 45, period: 'daily' }).catch(() => null),
        getUserCrmData({ userId }).catch(() => null),
      ]);
      setData(result);
      setAshrayData(ashrayRes);
      setBvData(bvRes);
      setChecklistData(checklistRes);
      setProgressStats(progressRes as any);
      if (crmRes) setCrmData(crmRes);
    } catch (error) {
      console.error('Failed to load user detail:', error);
      toast.error('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

  // Reload trend data when period changes (after initial load)
  useEffect(() => {
    if (!userId || !data) return;
    setTrendLoading(true);
    const days = trendPeriod === 'monthly' ? 365 : trendPeriod === 'weekly' ? 84 : 45;
    getUserProgressStats({ userId, days, period: trendPeriod })
      .then(res => setProgressStats(res as any))
      .catch(() => {})
      .finally(() => setTrendLoading(false));
  }, [trendPeriod]);

  const openWhatsApp = () => {
    if (!data) return;
    const firstName = (data.user.fullName || '').split(' ')[0] || data.user.fullName;
    const honorific = data.user.isResident ? ' Prabhu' : '';
    // Use yesterday's date — guides typically send reminders for the previous day's report
    const yesterday = subDays(new Date(), 1);
    const fullDate = format(yesterday, 'EEEE, d MMMM yyyy');
    const dateStr = `Yesterday, ${fullDate}`;
    const message = `Hare Krishna ${firstName}${honorific}!\n\nKindly submit your Sadhana report for *${dateStr}*. It only takes a minute and helps track your spiritual progress. 🙏`;
    const phone = normalizePhoneForLinks(data.user.phone ? String(data.user.phone) : '');
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="container mx-auto max-w-6xl">
          <Skeleton className="h-12 w-64 mb-6" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-32" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background p-4 flex items-center justify-center">
        <Card>
          <CardHeader>
            <CardTitle>User Not Found</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              You may not have permission to view this profile, or the user no longer exists.
            </CardDescription>
          </CardHeader>
          <CardContent><Button onClick={goBack}>Go Back</Button></CardContent>
        </Card>
      </div>
    );
  }

  const calendarEntries = (data.recentEntries || []).map((e: any) => ({
    entryDate: typeof e.entryDate === 'string' ? e.entryDate.slice(0, 10) : format(new Date(e.entryDate), 'yyyy-MM-dd'),
    scorePercent: e.scorePercent ?? null,
    totalScore: e.totalScore ?? 0,
    flagSick: e.flagSick ?? false,
    flagOs: e.flagOs ?? false,
  }));

  const bvCalendarEntries = (bvData?.userHistory || []).map((h: any) => ({
    entryDate: h.attendanceDate
      ? (typeof h.attendanceDate === 'string' ? h.attendanceDate.slice(0, 10) : format(new Date(h.attendanceDate), 'yyyy-MM-dd'))
      : '',
    scorePercent: h.status === 'P' ? 100 : 0,
    totalScore: h.status === 'P' ? (h.totalPoints || 1) : 0,
  })).filter((e: any) => e.entryDate);

  const bvSessions = (bvData?.userHistory || []).slice(0, 10);
  const bvWeeklyScore = bvData?.userTotalPointsThisWeek ?? null;

  const ashrayLevel = data.user.ashrayLevel || 'Jigyasa';
  const totalRequired = ashrayData
    ? ashrayData.practiceGroups.flatMap((g: any) => g.practices)
        .filter((p: any) => isRequired(p.requirements[ashrayLevel] || '')).length
    : 0;
  const checkedCount = checklistData ? checklistData.checkedItems.length : 0;

  const recentScores = (data.recentEntries || [])
    .filter((e: any) => e.scorePercent != null)
    .map((e: any) => e.scorePercent as number);
  const sadhanaAvg = recentScores.length > 0
    ? Math.round(recentScores.reduce((s: number, d: number) => s + d, 0) / recentScores.length)
    : 0;

  const isResident = data.user.isResident;
  const fieldConfigs = isResident ? RESIDENT_FIELD_CONFIGS : NR_FIELD_CONFIGS;
  const trendEntries = progressStats?.entries ?? [];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-6xl">
        <Button variant="ghost" onClick={goBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />Back
        </Button>

        {/* User Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">👤 {data.user.fullName}</h1>
            <p className="text-muted-foreground">{data.user.email}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge>{data.user.status}</Badge>
              {data.user.isResident ? (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                  🏠 {data.user.residencyName || 'FOLK Resident'}
                </Badge>
              ) : (
                <Badge variant="outline">🌐 Non-Resident</Badge>
              )}
              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                <span className="text-sm text-muted-foreground">📿 Ashray:</span>
                <AshrayLevelDropdown userId={data.user.userId} currentLevel={data.user.ashrayLevel || 'Jigyasa'} onUpdated={loadUserDetail} />
              </div>
              {data.user.guideName && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  Guide: {data.user.guideName}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            {data.user.phone && (
              <a href={`tel:+${normalizePhoneForLinks(data.user.phone)}`}>
                <Button variant="outline" className="border-blue-400 text-blue-600">
                  <Phone className="w-4 h-4 mr-2" />Call
                </Button>
              </a>
            )}
            <Button onClick={openWhatsApp} className="bg-green-600 hover:bg-green-700 text-white">
              <MessageCircle className="w-4 h-4 mr-2" />WhatsApp Reminder
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <MetricCard icon={<Flame className="w-6 h-6 text-orange-500" />} label="Sadhana Streak" value={`${data.metrics.currentStreak} days`} />
          <MetricCard icon={<TrendingUp className="w-6 h-6 text-primary" />} label="Sadhana Avg Score" value={`${sadhanaAvg}%`} />
          <MetricCard icon={<Leaf className="w-6 h-6 text-green-600" />} label="BV Weekly Score" value={bvWeeklyScore !== null ? String(bvWeeklyScore) : '—'} />
          <MetricCard icon={<Star className="w-6 h-6 text-amber-500" />} label="Ashraya Checked" value={`${checkedCount} / ${totalRequired}`} />
        </div>

        {/* Calendars */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-base font-bold mb-2 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />Sadhana Entries
            </p>
            <MiniCalendar entries={calendarEntries} onDayClick={(date) => setSelectedEntryDate(date)} isResident={isResident} />
          </div>
          <div>
            <p className="text-base font-bold mb-2 flex items-center gap-2">
              <Leaf className="w-5 h-5 text-green-600" />Bhakti Vriksha Attendance
            </p>
            <MiniCalendar entries={bvCalendarEntries} onDayClick={() => {}} />
          </div>
        </div>

        {/* Field Progress — stat tiles + multi-field trend chart */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="w-4 h-4 text-primary" />
                Field Progress
                <span className="text-sm font-normal text-muted-foreground">
                  ({progressStats?.submittedCount ?? 0} entries)
                </span>
              </CardTitle>
              {/* Period selector */}
              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      trendPeriod === p
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Field average tiles */}
            {progressStats?.fieldTrends?.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {(progressStats.fieldTrends as any[]).map((ft: any) => (
                  <div key={ft.field} className="bg-muted/40 rounded-lg p-2.5 flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">{ft.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-lg">{fmt.numDisplay(ft.avg)}
                        {ft.unit ? <span className="text-xs font-normal text-muted-foreground ml-0.5">{ft.unit}</span> : ''}
                      </span>
                      {ft.trend === 'up' && <ArrowUp className="w-3.5 h-3.5 text-green-600 shrink-0" />}
                      {ft.trend === 'down' && <ArrowDown className="w-3.5 h-3.5 text-destructive shrink-0" />}
                      {ft.trend === 'flat' && <Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    </div>
                    <span className={`text-[10px] font-medium ${ft.trend === 'up' ? 'text-green-600' : ft.trend === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {ft.trend === 'up' ? 'Improving' : ft.trend === 'down' ? 'Declining' : 'Stable'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Multi-field trend chart */}
            <FieldTrendChart
              data={trendEntries}
              fieldConfigs={fieldConfigs}
              isResident={isResident}
              defaultSelected="scorePercent"
              height={220}
              loading={trendLoading}
              showThreshold
            />
          </CardContent>
        </Card>

        {/* BV Sessions */}
        {bvSessions.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Leaf className="w-5 h-5 text-green-600" />Bhakti Vriksha Sessions
              </CardTitle>
              <CardDescription>Recent attendance records</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {bvSessions.map((h: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${h.status === 'P' ? 'bg-green-500' : 'bg-red-400'}`} />
                      <span className="text-sm font-medium">
                        {h.attendanceDate ? format(new Date(typeof h.attendanceDate === 'string' && h.attendanceDate.length === 10 ? h.attendanceDate + 'T00:00:00' : h.attendanceDate), 'MMM d, yyyy') : '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={h.status === 'P' ? 'default' : 'secondary'} className="text-xs">
                        {h.status === 'P' ? 'Present' : 'Absent'}
                      </Badge>
                      {h.totalPoints != null && (
                        <span className="text-xs text-muted-foreground">{h.totalPoints} pts</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Mini CRM: Ashray Journey, Trips & Dues, Rent History */}
        {crmData && (
          <div className="space-y-4 mb-6">
            <AshrayJourneyCard
              ashrayHistory={crmData.ashrayHistory}
              currentLevel={data.user.ashrayLevel || ''}
            />
            <TripsDuesCard
              userId={data.user.userId}
              trips={crmData.trips}
              canEdit={canEditTrips}
              isOwnProfile={false}
              onRefresh={loadUserDetail}
            />
            <RentHistoryCard
              userId={data.user.userId}
              rentPayments={crmData.rentPayments}
              canEdit={canEditRent}
              isOwnProfile={false}
              isResident={data.user.isResident}
              onRefresh={loadUserDetail}
            />
          </div>
        )}

        {/* Ashraya Checklist */}
        {ashrayData && data.user.ashrayLevel && (
          <div className="mb-6">
            <AshrayCriteriaGrid
              currentLevel={data.user.ashrayLevel}
              userId={data.user.userId}
              practiceGroups={ashrayData.practiceGroups}
              readOnly={true}
            />
          </div>
        )}

        {userId && (
          <EntryDetailModal
            userId={userId}
            entryDate={selectedEntryDate}
            onClose={() => setSelectedEntryDate(null)}
          />
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
