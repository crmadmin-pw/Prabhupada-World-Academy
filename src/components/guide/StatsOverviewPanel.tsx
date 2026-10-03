/**
 * StatsOverviewPanel — standalone Sadhana Stats sub-tab
 * Own period + residency filters. FOLK residencies persist across re-fetches.
 * Group trend chart + individual user stats, single-select field chips.
 */
import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getSadhanaStats, getUserProgressStats } from '@/lib/endpoints-sdk';
import FieldTrendChart, { RESIDENT_FIELD_CONFIGS, NR_FIELD_CONFIGS, PW_FIELD_CONFIGS, FieldConfig } from '@/components/stats/FieldTrendChart';
import { scoreColor } from '@/lib/scoring';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { ASHRAY_LEVELS } from '@/types/enums';

import { useUserProfile } from '@/contexts/UserProfileContext';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';

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
  { key: 'spReadingMinutes', label: 'Book Reading',    unit: 'min', yMax: 120 },
  { key: 'sbPoints',         label: 'SB Class',        unit: 'pts', yMax: 2 },
  { key: 'maNaGvPoints',     label: 'DA+NA+GP+Kirtan', unit: 'pts', yMax: 3 },
  { key: 'quotesTulasi',     label: 'Quotes/Pranam',   unit: 'pts', yMax: 1 },
  { key: 'bath',             label: 'Bath',            unit: 'pts', yMax: 1 },
  { key: 'japaVisible',      label: 'Japa MTH',        unit: 'pts', yMax: 2 },
  { key: 'cleanlinessPoints',label: 'Clean Area',      unit: 'pts', yMax: 1 },
  { key: 'reportSending',    label: 'SameDay Fill',    unit: 'pts', yMax: 1 },
  { key: 'dailyServicePoints', label: 'Service',       unit: 'pts', yMax: 2 },
  { key: 'sleepQualityPoints', label: 'Sleep Quality', unit: 'pts', yMax: 1 },
  { key: 'sleepHours',       label: 'Sleep',           unit: 'hrs', yMax: 10 },
  { key: 'studyMinutes',     label: 'Study',           unit: 'min', yMax: 180 },
  { key: 'reading',          label: 'Reading',         unit: 'min', yMax: 90 },
  { key: 'hearing',          label: 'Hearing',         unit: 'min', yMax: 90 },
  { key: 'fillingSameDay',   label: 'SameDay Fill',    unit: 'pts', yMax: 4 },
  { key: 'seva',             label: 'Seva',            unit: 'Yes/No', yMax: 1 },
  { key: 'bhaktiVriksha',    label: 'BV',              unit: 'Yes/No', yMax: 1 },
  { key: 'preachingMinutes', label: 'Preach',          unit: 'min', yMax: 180 },
  { key: 'booksDistributed', label: 'Books Dist',      unit: '',    yMax: 20 },
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

interface Props {
  guideId: string;
  bvslMode?: boolean;
  mentorMode?: boolean;
  facilitatorMode?: boolean;
  groupOptions?: SadhanaGroupOption[];
}

export default function StatsOverviewPanel({ guideId, bvslMode, mentorMode, facilitatorMode, groupOptions = [] }: Props) {
  const { profile } = useUserProfile();
  const normalizedSegment = String(profile?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  // Only an explicit FOLK profile gets FOLK stats. This also handles legacy
  // profiles that stored the department as "Prabhupada World".
  const isPw = normalizedSegment !== 'FOLK';

  const [period, setPeriod] = useState<Period>('30d');
  // Reading-group dashboards must start with every member visible; a resident
  // default silently hides non-resident members from RGF/Supervisor totals.
  const [residencyFilter, setResidencyFilter] = useState<ResidencyFilter>(isPw || bvslMode ? 'all' : 'resident');
  const [folkResidencyId, setFolkResidencyId] = useState<string>('all');
  const [ashrayFilter, setAshrayFilter] = useState<string>('all');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');

  const [groupStats, setGroupStats] = useState<any>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  // Store residencies separately so FOLK dropdown doesn't vanish on re-fetch
  const [residencies, setResidencies] = useState<{ residencyId: string; residencyName: string }[]>([]);

  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [userStats, setUserStats] = useState<any>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState('');

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);
  const effectiveGroupId = useMemo(() => {
    if (selectedGroupId === 'all') return 'all';
    return groupOptions.some(group => group.id === selectedGroupId || group.groupId === selectedGroupId)
      ? selectedGroupId
      : 'all';
  }, [groupOptions, selectedGroupId]);
  const selectedGroupName = effectiveGroupId === 'all'
    ? 'All Groups'
    : groupOptions.find(group => group.id === effectiveGroupId || group.groupId === effectiveGroupId)?.groupName || 'Reading Group';

  const loadGroupStats = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setGroupLoading(true);
    try {
      const data = await read(() => getSadhanaStats({
        guideId, startDate: start, endDate: end,
        bvslMode, mentorMode, facilitatorMode,
        residencyFilter: (residencyFilter === 'all' ? undefined : residencyFilter) as any,
        folkResidencyId: folkResidencyId === 'all' ? undefined : folkResidencyId,
        ashrayLevel: ashrayFilter === 'all' ? undefined : ashrayFilter,
        groupId: effectiveGroupId === 'all' ? undefined : effectiveGroupId,
        segment: isPw ? 'PW' : 'FOLK',
      }));
      setGroupStats(data);
      // Only update residencies when we actually get some (don't clear on filtered fetches)
      if ((data.availableResidencies ?? []).length > 0) {
        setResidencies(data.availableResidencies ?? []);
      }
    } catch {
      if (read.cancelled) return; /* keep cached stats visible */ }
    finally { if (!silent) setGroupLoading(false); }
  }, [guideId, start, end, bvslMode, mentorMode, facilitatorMode, residencyFilter, folkResidencyId, ashrayFilter, effectiveGroupId, isPw]);

  useEffect(() => { void loadGroupStats(); }, [loadGroupStats]);


  // Reset user when filters change
  useEffect(() => { setSelectedUserId(''); setUserStats(null); setUserError(''); }, [residencyFilter, folkResidencyId, ashrayFilter, effectiveGroupId, period]);

  useReactiveEffect((read) => {
    if (!selectedUserId) { !read.background && !read.cancelled && setUserStats(null); !read.background && !read.cancelled && setUserError(''); return; }
    let cancelled = false;
    !read.background && !read.cancelled && setUserLoading(true);
    !read.background && !read.cancelled && setUserError('');
    const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 31;
    read(() => getUserProgressStats({
      userId: selectedUserId,
      days,
      period: 'daily',
      includeToday: true,
      startDate: start,
      endDate: end,
    }))
      .then(data => { if (!cancelled) !read.cancelled && setUserStats(data); })
      .catch(() => {
        if (!cancelled) {
          !read.background && !read.cancelled && setUserStats(null);
          !read.background && !read.cancelled && setUserError('Unable to load this user’s stats. Please try again.');
        }
      })
      .finally(() => { if (!cancelled) !read.cancelled && setUserLoading(false); });
    return () => { cancelled = true; };
  }, [selectedUserId, period, start, end]);

  const groupFieldConfigs: FieldConfig[] = useMemo(() => {
    if (isPw) return PW_FIELD_CONFIGS;
    if (residencyFilter === 'resident' || residencyFilter === 'scholar') return RESIDENT_FIELD_CONFIGS;
    if (residencyFilter === 'non_resident') return NR_FIELD_CONFIGS;
    return ALL_FIELD_CONFIGS;
  }, [isPw, residencyFilter]);

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

            {!isPw && (
              <>
                {/* Residency */}
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">Residency:</Label>
                  <Select value={residencyFilter} onValueChange={(v) => { if (v) setResidencyFilter(v); }}>
                    <SelectTrigger className="h-7 w-[130px] text-xs">
                      <span className="truncate">
                        {residencyFilter === 'all'
                          ? 'All'
                          : residencyFilter === 'resident'
                          ? 'Residents'
                          : residencyFilter === 'non_resident'
                          ? 'Non-Residents'
                          : 'Scholars'}
                      </span>
                    </SelectTrigger>
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
                        <span className="truncate">
                          {folkResidencyId === 'all'
                            ? 'All'
                            : (residencies.find(r => r.residencyId === folkResidencyId)?.residencyName.replace(/^FOLK\s+/i, '') || folkResidencyId)}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {residencies.map(r => (
                          <SelectItem key={r.residencyId} value={r.residencyId}>
                            {r.residencyName.replace(/^FOLK\s+/i, '')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {groupOptions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">Group:</Label>
                <Select value={effectiveGroupId} onValueChange={(value: string | null) => setSelectedGroupId(value || 'all')}>
                  <SelectTrigger className="h-7 w-[180px] text-xs">
                    <span className="truncate">{selectedGroupName}</span>
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="all">All Groups</SelectItem>
                    {groupOptions.map(group => (
                      <SelectItem key={group.id} value={group.id}>{group.groupName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}


            {/* Ashray */}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs font-medium whitespace-nowrap text-muted-foreground">Ashraya:</Label>
              <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'all')}>
                <SelectTrigger className="h-7 w-[120px] text-xs">
                  <SelectValue>{ashrayFilter === 'all' ? 'All Levels' : ashrayFilter}</SelectValue>
                </SelectTrigger>
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
            {facilitatorMode ? 'RGF/RGSF Sadhana Trends' : 'Group Field Trends'}
            {groupStats && (
              <span className="text-xs font-normal text-muted-foreground">
                · {groupStats.totalUsers} {facilitatorMode ? 'RGFs/RGSFs' : 'members'} · {groupStats.totalSubmitted ?? 0} entries
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
              showThreshold={!isPw}
              isResident={!isPw && (residencyFilter === 'resident' || residencyFilter === 'scholar' || residencyFilter === 'all')}
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
            <div>
              <CardTitle className="text-sm font-semibold">
                {facilitatorMode ? 'Individual RGF/RGSF Sadhana' : 'Individual User Stats'}
              </CardTitle>
              {facilitatorMode && (
                <p className="mt-1 text-xs text-muted-foreground">Select an RGF or RGSF in this admin’s reporting hierarchy to view their personal Sadhana trends.</p>
              )}
            </div>
            {(() => {
              const selectedUser = userList.find((user: any) => String(user.userId) === selectedUserId);
              return (
            <Select value={selectedUserId} onValueChange={(v) => setSelectedUserId(v || '')}>
              <SelectTrigger className="h-8 w-[220px]">
                <span className="truncate text-left">{selectedUser?.fullName || (facilitatorMode ? 'Select an RGF/RGSF…' : 'Select a user…')}</span>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {userList.map((u: any) => (
                  <SelectItem key={u.userId} value={String(u.userId)}>
                    <span className="font-medium">{u.fullName}</span>
                    {facilitatorMode && u.facilitatorRole && (
                      <span className="ml-2 text-[10px] font-semibold text-primary">{u.facilitatorRole}</span>
                    )}
                    {u.avgScorePercent > 0 && (
                      <span className={`ml-2 text-xs ${scoreColor(u.avgScorePercent, u.isResident)}`}> {u.avgScorePercent}%</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
              );
            })()}
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
              {facilitatorMode ? 'Select an RGF or RGSF above to view their Sadhana trends' : 'Select a user above to view their individual field trends'}
            </div>
          ) : userLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : userError ? (
            <div className="flex items-center justify-center h-28 text-destructive text-sm">
              {userError}
            </div>
          ) : userStats && userChartData.length > 0 ? (
            <FieldTrendChart
              data={userChartData}
              fieldConfigs={isPw ? PW_FIELD_CONFIGS : (userStats.isResident ? RESIDENT_FIELD_CONFIGS : NR_FIELD_CONFIGS)}
              defaultSelected="scorePercent"
              height={240}
              showThreshold={!isPw}
              isResident={!isPw && userStats.isResident}
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
