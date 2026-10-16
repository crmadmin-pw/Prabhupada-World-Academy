/**
 * BvStatsPanel — BV preaching trend charts, mirrors StatsOverviewPanel.
 */
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getBvStats, getGuideGroupStats } from '@/lib/endpoints-sdk';
import FieldTrendChart from '@/components/stats/FieldTrendChart';
import type { FieldConfig } from '@/components/stats/FieldTrendChart';
import type { SadhanaGroupOption } from '@/components/guide/ReportsTab';
import { useSupervisionOnly } from '@/components/guide/supervisionScope';

type Period = '7d' | '30d' | '90d' | 'current_month' | 'prev_month';

const PERIODS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'current_month', label: 'This Month' },
  { value: 'prev_month', label: 'Prev Month' },
];

export const BV_FIELD_CONFIGS: FieldConfig[] = [
  { key: 'totalPreachingMinutes', label: 'Total Preaching', unit: 'min', yMax: 300 },
  { key: 'prCallingTime',         label: 'Calling',         unit: 'min', yMax: 180 },
  { key: 'prOneOnOneTime',        label: '1-on-1',          unit: 'min', yMax: 120 },
  { key: 'prBookDistTime',        label: 'Book Dist',       unit: 'min', yMax: 120 },
  { key: 'prRduaTime',            label: 'RDUA',            unit: 'min', yMax: 60  },
  { key: 'prPlanTime',            label: 'Plan',            unit: 'min', yMax: 60  },
  { key: 'prBooksDistributed',    label: 'Books',           unit: '',    yMax: 20  },
  { key: 'prContactsCollected',   label: 'Contacts',        unit: '',    yMax: 30  },
  { key: 'prUniqueOneOnOnes',     label: 'Unique 1-on-1s',  unit: '',    yMax: 20  },
];

const MEMBER_BV_FIELD_CONFIGS: FieldConfig[] = [
  { key: 'totalPreachingMinutes', label: 'Preaching',         unit: 'min', yMax: 300 },
  { key: 'prBooksDistributed',    label: 'Books Distributed', unit: '',    yMax: 20  },
];

function getPeriodDates(period: Period): { start: string; end: string } {
  const today = new Date();
  switch (period) {
    case '7d':            return { start: format(subDays(today, 6), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case '30d':           return { start: format(subDays(today, 29), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case '90d':           return { start: format(subDays(today, 89), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case 'current_month': return { start: format(startOfMonth(today), 'yyyy-MM-dd'), end: format(today, 'yyyy-MM-dd') };
    case 'prev_month': {
      const pm = subMonths(today, 1);
      return { start: format(startOfMonth(pm), 'yyyy-MM-dd'), end: format(endOfMonth(pm), 'yyyy-MM-dd') };
    }
  }
}

interface Props {
  guideId: string;
  bvslMode?: boolean;
  residencyIds?: string[];
  showIndividualStats?: boolean;
  /** Groups already resolved for a supervisor's hierarchy. */
  groupOptions?: SadhanaGroupOption[];
  segment?: 'PW' | 'FOLK';
}

export default function BvStatsPanel({ guideId, bvslMode, residencyIds, showIndividualStats, groupOptions = [], segment }: Props) {
  const supervisionOnly = useSupervisionOnly();
  const [period, setPeriod]               = useState<Period>('30d');
  const [groupStats, setGroupStats]       = useState<any>(null);
  const [groupLoading, setGroupLoading]   = useState(false);
  const [individualStats, setIndividualStats] = useState<any>(null);
  const [individualLoading, setIndividualLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('all');
  const [loadedGroupOptions, setLoadedGroupOptions] = useState<SadhanaGroupOption[]>([]);

  const availableGroupOptions = groupOptions.length > 0 ? groupOptions : loadedGroupOptions;

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  const loadGroupStats = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setGroupLoading(true);
    try {
      const result = await read(() => getBvStats({
        guideId,
        startDate: start,
        endDate: end,
        bvslMode,
        residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined,
        groupId: selectedGroupId === 'all' ? undefined : selectedGroupId,
        segment,
        supervisionOnly: supervisionOnly || undefined,
      }));
      setGroupStats(result);
    } catch {
      if (read.cancelled) return;
      // Keep the last successful trend visible if a background refresh fails.
    } finally {
      if (!silent) setGroupLoading(false);
    }
  }, [guideId, start, end, bvslMode, residencyIds, selectedGroupId, segment, supervisionOnly]);

  useEffect(() => { void loadGroupStats(); }, [loadGroupStats]);
  // A Sadhana submission can include BV activity. Re-query on that event so
  // the chart changes immediately, without a timer or a manual refresh.


  const loadGroupOptions = useReactiveLoader(async (read) => {
    if (groupOptions.length > 0) return;
    try {
      const result = await read(() => getGuideGroupStats({
        guideId,
        bvslMode,
        residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined,
        segment,
        supervisionOnly: supervisionOnly || undefined,
      }));
      setLoadedGroupOptions(result.groups.map((group: any) => ({
        id: String(group.groupId),
        groupId: String(group.groupId),
        groupName: group.groupName || 'Reading Group',
      })));
    } catch {
      if (read.cancelled) return;
      setLoadedGroupOptions([]);
    }
  }, [guideId, bvslMode, residencyIds, segment, groupOptions.length, supervisionOnly]);

  useEffect(() => { void loadGroupOptions(); }, [loadGroupOptions]);


  const loadIndividualStats = useReactiveLoader(async (read, silent = false) => {
    if (!selectedUserId) {
      setIndividualStats(null);
      return;
    }
    if (!silent) !read.background && setIndividualLoading(true);
    try {
      const result = await read(() => getBvStats({
        guideId,
        startDate: start,
        endDate: end,
        bvslMode,
        residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined,
        groupId: selectedGroupId === 'all' ? undefined : selectedGroupId,
        subjectUserId: selectedUserId,
        segment,
        supervisionOnly: supervisionOnly || undefined,
      }));
      setIndividualStats(result);
    } catch {
      if (read.cancelled) return;
      // Keep the previous successful individual trend visible during a refresh failure.
    } finally {
      if (!silent) setIndividualLoading(false);
    }
  }, [guideId, start, end, bvslMode, residencyIds, selectedGroupId, selectedUserId, segment, supervisionOnly]);

  useEffect(() => { void loadIndividualStats(); }, [loadIndividualStats]);


  useEffect(() => { setSelectedUserId(''); }, [period]);

  useEffect(() => {
    if (selectedGroupId !== 'all' && !availableGroupOptions.some(group => group.id === selectedGroupId || group.groupId === selectedGroupId)) {
      setSelectedGroupId('all');
    }
  }, [availableGroupOptions, selectedGroupId]);

  const selectedGroupName = selectedGroupId === 'all'
    ? 'All Groups'
    : availableGroupOptions.find(group => group.id === selectedGroupId || group.groupId === selectedGroupId)?.groupName || 'Reading Group';

  const groupChartData = useMemo(() => {
    if (!groupStats?.dailyTrend) return [];
    return groupStats.dailyTrend;
  }, [groupStats]);

  const isMemberScope = groupStats?.subjectType === 'members' || (!!bvslMode && showIndividualStats === false);
  const fieldConfigs = isMemberScope ? MEMBER_BV_FIELD_CONFIGS : BV_FIELD_CONFIGS;

  const userList = useMemo(() => {
    if (!groupStats?.userSummaries) return [];
    return [...groupStats.userSummaries].sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));
  }, [groupStats]);

  // The selected facilitator uses a separately scoped request so its chart
  // contains only that person's entries, never the group average.
  const selectedUserInfo = useMemo(() => {
    if (!selectedUserId) return null;
    return userList.find((u: any) => String(u.userId) === selectedUserId) || null;
  }, [selectedUserId, userList]);
  const individualChartData = useMemo(() => individualStats?.dailyTrend || [], [individualStats]);

  return (
    <div className="space-y-4">
      {/* Period filter */}
      <Card>
        <CardContent className="pt-4 pb-3">
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
            {availableGroupOptions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Group:</span>
                <Select value={selectedGroupId} onValueChange={(value) => setSelectedGroupId(value || 'all')}>
                  <SelectTrigger className="h-8 w-[220px]">
                    <SelectValue>{selectedGroupName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {availableGroupOptions.map(group => (
                      <SelectItem key={group.id} value={group.id}>{group.groupName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Group trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {isMemberScope ? 'BV Member Trends' : 'BV Field Trends'} ({selectedGroupName} Averages)
            {groupStats && (
              <span className="text-xs font-normal text-muted-foreground">
                · {groupStats.totalUsers} {isMemberScope
                  ? (groupStats.totalUsers === 1 ? 'Member' : 'Members')
                  : 'RGFs/RGSFs'} · {groupStats.totalSubmitted ?? 0} entries
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
              fieldConfigs={fieldConfigs}
              defaultSelected="totalPreachingMinutes"
              height={260}
              loading={groupLoading && !groupStats}
            />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              {groupLoading ? 'Loading…' : 'No data for this period'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual RGF stats (Supervisor dashboard only) */}
      {(showIndividualStats ?? !bvslMode) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-sm font-semibold">Individual RGF Stats</CardTitle>
              <Select value={selectedUserId} onValueChange={(val) => setSelectedUserId(val || '')}>
                <SelectTrigger className="h-8 w-[220px]">
                  <SelectValue>
                    {userList.find((u: any) => String(u.userId) === selectedUserId)?.fullName || "Select an RGF…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {userList.map((u: any) => (
                    <SelectItem key={u.userId} value={String(u.userId)}>
                      {u.fullName}
                      {u.submittedCount > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">{u.submittedCount}d</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedUserInfo && (
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs font-medium">{selectedUserInfo.fullName}</span>
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs">{selectedUserInfo.submittedCount}/{selectedUserInfo.totalDays}d submitted</span>
                <span className="px-2.5 py-1 rounded-full bg-muted text-xs font-bold text-primary">
                  Avg {minutesToHHMM(selectedUserInfo.avgTotalPreachingMinutes)}
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!selectedUserId ? (
              <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
                Select an RGF above to view their individual field trends
              </div>
            ) : individualLoading && !individualStats ? (
              <Skeleton className="h-72 w-full" />
            ) : individualChartData.length > 0 ? (
              <FieldTrendChart
                data={individualChartData}
                fieldConfigs={BV_FIELD_CONFIGS}
                defaultSelected="totalPreachingMinutes"
                height={260}
                loading={individualLoading && !individualStats}
              />
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                {individualLoading ? 'Loading…' : 'No submitted BV data for this RGF in the selected period'}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function minutesToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
