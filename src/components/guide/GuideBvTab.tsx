import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Users, ChevronRight, Leaf, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getGuideGroupStats } from '@/lib/endpoints-sdk';
import type { GetGuideGroupStatsOutputType } from '@/lib/endpoints-sdk';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useSupervisionOnly } from '@/components/guide/supervisionScope';

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; summaryOnly?: boolean; segment?: 'PW' | 'FOLK'; }

type GroupStat = GetGuideGroupStatsOutputType['groups'][0];

function GroupCard({ group, onClick }: { group: GroupStat; onClick: () => void }) {
  const isVacant = group.memberCount === 0;
  const rateColor = group.attendanceRate >= 75 ? 'text-emerald-600 dark:text-emerald-400' : group.attendanceRate >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500';
  return (
    <Card
      className={`group relative cursor-pointer rounded-2xl border border-border/80 bg-card shadow-xs hover:shadow-lg hover:border-primary/40 transition-all duration-200 overflow-hidden flex flex-col justify-between ${isVacant ? 'opacity-75' : ''}`}
      onClick={onClick}
    >
      <div className={`h-1.5 w-full bg-gradient-to-r ${isVacant ? 'from-muted-foreground/30 to-muted-foreground/10' : 'from-primary via-orange-500 to-amber-500'} opacity-90 group-hover:opacity-100 transition-opacity`} />
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base text-foreground truncate group-hover:text-primary transition-colors">{group.groupName}</span>
                  {group.isActive === false && <Badge variant="secondary" className="text-[10px] shrink-0">Inactive</Badge>}
                  {isVacant && <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Vacant</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  RGF: {group.bvslName || '—'} · {group.memberCount} members
                </p>
              </div>
            </div>

            {isVacant ? (
              <p className="text-xs text-muted-foreground/70 italic pt-1">No members yet — share the join link to invite</p>
            ) : (
              <div className="flex items-center gap-2.5 pt-1 flex-wrap">
                <span className={`text-base font-extrabold ${rateColor}`}>{group.attendanceRate}%</span>
                <span className="text-xs text-muted-foreground font-medium">
                  ({group.presentCount}/{group.totalSessions} sessions)
                </span>
                <Badge variant="outline" className={`text-[10px] font-semibold ${rateColor} border-current/40 px-2 py-0.5`}>
                  {group.attendanceRate >= 75 ? 'Good' : group.attendanceRate >= 50 ? 'Fair' : 'Needs Attention'}
                </Badge>
              </div>
            )}
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
        </div>
      </CardContent>
    </Card>
  );
}

function PerformanceChart({ groups }: { groups: GroupStat[] }) {
  const data = groups.map(g => ({
    name: g.groupName.length > 12 ? g.groupName.slice(0, 12) + '…' : g.groupName,
    'Attendance %': g.attendanceRate,
  }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">Group Performance Comparison</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip formatter={(val: any) => [`${val}%`, 'Attendance']} />
            <Bar dataKey="Attendance %" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function GuideBvTab({ guideId, bvslMode, residencyIds, summaryOnly = false, segment }: Props) {
  const navigate = useNavigate();
  const supervisionOnly = useSupervisionOnly();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupStat[]>([]);

  useEffect(() => { loadGroups(); }, [guideId, bvslMode, residencyIds, segment, supervisionOnly]);

  const loadGroups = useReactiveLoader(async (read) => {
    !read.background && !read.cancelled && setLoading(true);
    try {
      const result = await read(() => getGuideGroupStats({ guideId, bvslMode, residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined, segment, supervisionOnly: supervisionOnly || undefined }));
      !read.cancelled && setGroups(result.groups);
    } catch {
      if (read.cancelled) return;
      toast.error('Failed to load BV groups');
    } finally {
      !read.cancelled && setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No BV groups found</p>
          <p className="text-sm mt-1">BV groups will appear here once RGFs create them.</p>
        </CardContent>
      </Card>
    );
  }

  if (summaryOnly) {
    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-base font-semibold mb-1">Group Attendance Summary</h3>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold">Group</th>
                  <th className="px-4 py-3 text-xs font-semibold">RGF</th>
                  <th className="px-4 py-3 text-xs font-semibold text-center">Members</th>
                  <th className="px-4 py-3 text-xs font-semibold text-center">Present / Sessions</th>
                  <th className="px-4 py-3 text-xs font-semibold min-w-[220px]">Attendance</th>
                  <th className="px-4 py-3 text-xs font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const rateColor = group.attendanceRate >= 75 ? 'text-emerald-600' : group.attendanceRate >= 50 ? 'text-amber-600' : 'text-rose-500';
                  const status = group.attendanceRate >= 75 ? 'Good' : group.attendanceRate >= 50 ? 'Fair' : 'Needs Attention';
                  return (
                    <tr key={group.groupId} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-2">
                          {group.groupName}
                          {group.isActive === false && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{group.bvslName || 'Unassigned'}</td>
                      <td className="px-4 py-3 text-center">{group.memberCount}</td>
                      <td className="px-4 py-3 text-center">{group.presentCount}/{group.totalSessions}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`w-10 font-bold ${rateColor}`}>{group.attendanceRate}%</span>
                          <div className="h-2 flex-1 max-w-[130px] overflow-hidden rounded-full bg-muted">
                            <div className={`h-full rounded-full ${group.attendanceRate >= 75 ? 'bg-emerald-500' : group.attendanceRate >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${group.attendanceRate}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center"><Badge variant="outline" className={`text-[10px] ${rateColor} border-current/40`}>{status}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold mb-1">BV Groups</h3>
        <p className="text-sm text-muted-foreground">Click a group to view attendance records and member stats.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(g => (
          <GroupCard
            key={g.groupId}
            group={g}
            onClick={() => navigate(bvslMode ? `/bvsl/groups/${g.groupId}` : `/guide/bv-group/${g.groupId}`)}
          />
        ))}
      </div>

      {groups.length > 1 && <PerformanceChart groups={groups} />}
    </div>
  );
}
