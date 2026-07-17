/**
 * BvStatsPanel — BV preaching trend charts, mirrors StatsOverviewPanel.
 */
import { useState, useEffect, useMemo } from 'react';
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { getBvStats } from 'zite-endpoints-sdk';
import FieldTrendChart from '@/components/stats/FieldTrendChart';
import type { FieldConfig } from '@/components/stats/FieldTrendChart';

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

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; }

export default function BvStatsPanel({ guideId, bvslMode, residencyIds }: Props) {
  const [period, setPeriod]               = useState<Period>('30d');
  const [groupStats, setGroupStats]       = useState<any>(null);
  const [groupLoading, setGroupLoading]   = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const { start, end } = useMemo(() => getPeriodDates(period), [period]);

  useEffect(() => {
    setGroupLoading(true);
    getBvStats({ guideId, startDate: start, endDate: end, bvslMode, residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined })
      .then(setGroupStats)
      .catch(() => {})
      .finally(() => setGroupLoading(false));
  }, [guideId, start, end, bvslMode]);

  useEffect(() => { setSelectedUserId(''); }, [period]);

  const groupChartData = useMemo(() => {
    if (!groupStats?.dailyTrend) return [];
    return groupStats.dailyTrend;
  }, [groupStats]);

  const userList = useMemo(() => {
    if (!groupStats?.userSummaries) return [];
    return [...groupStats.userSummaries].sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));
  }, [groupStats]);

  // For individual BVSL stats, we re-use the group trend data filtered to that BVSL
  // (getBvStats returns group averages; for individual we'd need per-user entries)
  // Show the group chart data as the user chart for now — individual selection shows their averages
  const selectedUserInfo = useMemo(() => {
    if (!selectedUserId) return null;
    return userList.find((u: any) => String(u.userId) === selectedUserId) || null;
  }, [selectedUserId, userList]);

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
          </div>
        </CardContent>
      </Card>

      {/* Group trend chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            BV Field Trends (Group Averages)
            {groupStats && (
              <span className="text-xs font-normal text-muted-foreground">
                · {groupStats.totalUsers} BVSLs · {groupStats.totalSubmitted ?? 0} entries
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
              fieldConfigs={BV_FIELD_CONFIGS}
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

      {/* Individual BVSL stats */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-sm font-semibold">Individual BVSL Stats</CardTitle>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="h-8 w-[220px]">
                <SelectValue placeholder="Select a BVSL…" />
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
              Select a BVSL above to view their individual field trends
            </div>
          ) : (
            <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
              Individual per-BVSL trend data requires separate entry fetch.
              Use the Report tab to view this BVSL's data for a specific date range.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function minutesToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
