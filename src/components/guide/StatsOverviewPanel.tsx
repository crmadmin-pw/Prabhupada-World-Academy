/**
 * StatsOverviewPanel — standalone Sadhana Stats sub-tab
 * Own period + residency filters. FOLK residencies persist across re-fetches.
 * Group trend chart + individual user stats, single-select field chips.
 */
import { useState, useEffect, useMemo } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getSadhanaStats, getUserProgressStats } from 'zite-endpoints-sdk';
import FieldTrendChart, { RESIDENT_FIELD_CONFIGS, NR_FIELD_CONFIGS, FieldConfig } from '@/components/stats/FieldTrendChart';
import { scoreColor } from '@/lib/scoring';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { ASHRAY_LEVELS } from '@/types/enums';

type Period = '7d' | '30d' | '90d' | 'current_month' | 'prev_month';
type ResidencyFilter = 'all' | 'resident' | 'non_resident' | 'scholar';

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'current_month', label: 'This Month' },
  { value: 'prev_month', label: 'Prev Month' },
];

// Combined config showing all fields (for "All" residency filter)
const ALL_FIELD_CONFIGS: FieldConfig[] = [
  { key: 'scorePercent',     label: 'Overall %',      unit: '%',   yMax: 100 },
  { key: 'rounds',           label: 'Rounds',          unit: '',    yMax: 32 },
  { key: 'spReadingMinutes', label: 'SP Reading',      unit: 'min', yMax: 120 },
  { key: 'sbPoints',         label: 'SB',              unit: 'pts', yMax: 2 },
  { key: 'maNaGvPoints',    label: 'MA/NA/GV',        unit: 'pts', yMax: 2 },
  { key: 'quotesTulasi',     label: 'Quotes+Tulasi',   unit: 'pts', yMax: 2 },
  { key: 'bath',             label: 'Bath',            unit: 'pts', yMax: 1 },
  { key: 'japaVisible',      label: 'Japa Visible',    unit: 'pts', yMax: 1 },
  { key: 'cleanlinessPoints',label: 'Cleanliness',     unit: 'pts', yMax: 2 },
  { key: 'reportSending',    label: 'Report Sending',  unit: 'pts', yMax: 1 },
  { key: 'dailyServicePoints', label: 'Daily Service', unit: 'pts', yMax: 2 },
  { key: 'sleepQualityPoints', label: 'Sleep Quality', unit: 'pts', yMax: 1 },
  { key: 'sleepHours',       label: 'Sleep Hours',     unit: 'hrs', yMax: 10 },
  { key: 'studyMinutes',     label: 'Study',           unit: 'min', yMax: 180 },
  { key: 'reading',          label: 'Reading',         unit: 'min', yMax: 90 },
  { key: 'hearing',          label: 'Hearing',         unit: 'min', yMax: 90 },
  { key: 'fillingSameDay',   label: 'Same Day',        unit: 'pts', yMax: 1 },
  { key: 'seva',             label: 'Seva',            unit: 'Yes/No', yMax: 1 },
  { key: 'bhaktiVriksha',    label: 'BV Attended',     unit: 'Yes/No', yMax: 1 },
  { key: 'preachingMinutes', label: 'Preaching',       unit: 'min', yMax: 180 },
  { key: 'booksDistributed', label: 'Books',           unit: '',    yMax: 20 },
];

function getPeriodDates(period: Period): { start: string; end: string } {
  const today = new Date();
  switch (period) {
    case '7d': return { start: format(subDays(today, 6), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case '30d': return { start: format(subDays(today, 29), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case '90d': return { start: format(subDays(today, 89), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case 'current_month': return { start: format(startOfMonth(today), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case 'prev_month': {
      const pm = subMonths(today, 1);
      return { start: format(startOfMonth(pm), 'yyyy-MM-dd'), end: format(endOfMonth(pm), 'yyyy-MM-dd') };
    }
  }
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <ArrowUp className="w-3.5 h-3.5 text-green-600" />;
  if (trend === 'down') return <ArrowDown className="w-3.5 h-3.5 text-destructive" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}

interface Props { guideId: string; bvslMode?: boolean; mentorMode?: boolean; }

export default function StatsOverviewPanel({ guideId, bvslMode, mentorMode }: Props) {
  const [period, setPeriod] = useState<Period>('30d');
  const [residencyFilter, setResidencyFilter] = useState<ResidencyFilter>('resident');
  const [folkResidencyId, setFolkResidencyId] = useState<string>('all');
  const [ashrayFilter, setAshrayFilter] = useState<string>('all');

  const [groupStats, setGroupStats] = useState<any>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  // Store residencies separately so FOLK dropdown doesn't vanish on re-fetch
  const [residencies, setResidencies] = useState<{ residencyId: string; residencyName: string }[]>([]);

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userStats, setUserStats] = useState<any>(null);
  const [userLoading, setUserLoading] = useState(false);

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  // Fetch group stats — don't clear groupStats on re-fetch to avoid FOLK dropdown flash
  useEffect(() => {
    setGroupLoading(true);
    getSadhanaStats({
      guideId, startDate: start, endDate: end,
      bvslMode, mentorMode,
      residencyFilter: (residencyFilter === 'all' ? undefined : residencyFilter) as any,
      folkResidencyId: folkResidencyId === 'all' ? undefined : folkResidencyId,
      ashrayLevel: ashrayFilter === 'all' ? undefined : ashrayFilter,
    }).then(data => {
      setGroupStats(data);
      // Only update residencies when we actually get some (don't clear on filtered fetches)
      if ((data.availableResidencies ?? []).length > 0) {
        setResidencies(data.availableResidencies);
      }
    }).catch(() => {}).finally(() => setGroupLoading(false));
  }, [guideId, start, end, bvslMode, mentorMode, residencyFilter, folkResidencyId, ashrayFilter]);

  // Reset user when filters change
  useEffect(() => { setSelectedUserId(''); setUserStats(null); }, [residencyFilter, folkResidencyId, period]);

  useEffect(() => {
    if (!selectedUserId) { setUserStats(null); return; }
    setUserLoading(true);
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 31;
    getUserProgressStats({ userId: selectedUserId, days, period: 'daily' })
      .then(data => setUserStats(data))
      .catch(() => {})
      .finally(() => setUserLoading(false));
  }, [selectedUserId, period]);

  const groupFieldConfigs: FieldConfig[] = useMemo(() => {
    if (residencyFilter === 'resident' || residencyFilter === 'scholar') return RESIDENT_FIELD_CONFIGS;
    if (residencyFilter === 'non_resident') return NR_FIELD_CONFIGS;
    return ALL_FIELD_CONFIGS;
  }, [residencyFilter]);

  // Map dailyTrend → chart data (add scorePercent alias for avgScorePercent)
  const groupChartData = useMemo(() => {
    if (!groupStats?.dailyTrend) return [];
    return (groupStats.dailyTrend as any[]).map(d => ({
      ...d,
      label: format(new Date(d.date + 'T00:00:00'), 'MMM d'),
      scorePercent: d.avgScorePercent,
    }));
  }, [groupStats]);

  const userChartData = useMemo(() => userStats?.entries ?? [], [userStats]);

  const userList = useMemo(() => {
    if (!groupStats?.userSummaries) return [];
    return [...(groupStats.userSummaries as any[])].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [groupStats]);

  return (
    <div className="space-y-4">

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-x-4 gap-y-3 items-center">
            {/* Period chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Period:</span>
              <div className="flex flex-wrap gap-1.5">
                {PERIODS.map(({ value, label }) => (
                  <button key={value} onClick={() => setPeriod(value)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                      period === value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground/30'
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>

            {/* Residency */}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">Residency:</Label>
              <Select value={residencyFilter} onValueChange={(v) => { if (v) setResidencyFilter(v); }}>
                <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resident">Residents</SelectItem>
                  <SelectItem value="non_resident">Non-Residents</SelectItem>
                  <SelectItem value="scholar">Scholars</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* FOLK — uses separate residencies state so dropdown never disappears */}
            {residencies.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">FOLK:</Label>
                <Select value={folkResidencyId} onValueChange={(v) => setFolkResidencyId(v || 'all')}>
                  <SelectTrigger className="h-8 w-[140px]">
                    {residencyFilter === 'all' ? 'All Members' : residencyFilter === 'resident' ? 'Residents' : residencyFilter === 'non_resident' ? 'Non-Residents' : 'Scholars'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {residencies.map(r => (
                      <SelectItem key={r.residencyId} value={r.residencyId}>{r.residencyName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Ashray */}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">Ashraya:</Label>
              <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'all')}>
                <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Group trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Group Field Trends
            {groupStats && (
              <span className="text-xs font-normal text-muted-foreground">
                · {groupStats.totalUsers} members · {groupStats.totalSubmitted ?? 0} entries
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {groupLoading && !groupStats ? (
            <Skeleton className="h-72 w-full" />
          ) : groupChartData.length > 0 ? (
            <FieldTrendChart
              data={groupChartData}
              fieldConfigs={groupFieldConfigs}
              defaultSelected="scorePercent"
              height={260}
              showThreshold
              isResident={residencyFilter === 'resident' || residencyFilter === 'scholar' || residencyFilter === 'all'}
              loading={groupLoading && !groupStats}
            />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              {groupLoading ? 'Loading…' : 'No data for this period'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual user */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm font-semibold">Individual User Stats</CardTitle>
            <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v || '')}>
              <SelectTrigger className="h-8 w-[220px]">
                <SelectValue placeholder="Select a user…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {userList.map((u: any) => (
                  <SelectItem key={u.userId} value={String(u.userId)}>
                    <span className="font-medium">{u.fullName}</span>
                    {u.avgScorePercent > 0 && (
                      <span className={`ml-2 text-xs ${scoreColor(u.avgScorePercent, u.isResident)}`}> {u.avgScorePercent}%</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Summary chips */}
          {selectedUserId && (() => {
            const us = (groupStats?.userSummaries as any[] ?? []).find((u: any) => String(u.userId) === selectedUserId);
            if (!us) return null;
            return (
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs font-medium">{us.fullName}</span>
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs">{us.submittedCount}/{us.totalDays}d submitted</span>
                <span className={`px-2.5 py-1 rounded-full bg-muted text-xs font-bold ${scoreColor(us.avgScorePercent, us.isResident)}`}>Avg {us.avgScorePercent}%</span>
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs flex items-center gap-1">
                  <TrendIcon trend={us.trend} />
                  {us.trend === 'up' ? 'Improving' : us.trend === 'down' ? 'Declining' : 'Stable'}
                </span>
                {us.isResident && <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs">{us.residencyName || 'Resident'}</span>}
              </div>
            );
          })()}
        </CardHeader>
        <CardContent>
          {!selectedUserId ? (
            <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
              Select a user above to view their individual field trends
            </div>
          ) : userLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : userStats && userChartData.length > 0 ? (
            <FieldTrendChart
              data={userChartData}
              fieldConfigs={userStats.isResident ? RESIDENT_FIELD_CONFIGS : NR_FIELD_CONFIGS}
              defaultSelected="scorePercent"
              height={240}
              showThreshold
              isResident={userStats.isResident}
            />
          ) : (
            <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
              No entries found for this period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
