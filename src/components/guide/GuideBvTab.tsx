import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Users, ChevronRight, Leaf, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getGuideGroupStats } from 'zite-endpoints-sdk';
import type { GetGuideGroupStatsOutputType } from 'zite-endpoints-sdk';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props { guideId: string; bvslMode?: boolean; residencyIds?: string[]; }

type GroupStat = GetGuideGroupStatsOutputType['groups'][0];

function GroupCard({ group, onClick }: { group: GroupStat; onClick: () => void }) {
  const isVacant = group.memberCount === 0;
  const rateColor = group.attendanceRate >= 75 ? 'text-green-600' : group.attendanceRate >= 50 ? 'text-yellow-600' : 'text-red-500';
  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${isVacant ? 'border-l-muted-foreground opacity-70' : 'border-l-primary'}`}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Leaf className={`w-4 h-4 shrink-0 ${isVacant ? 'text-muted-foreground' : 'text-primary'}`} />
              <span className="font-semibold truncate">{group.groupName}</span>
              {isVacant && <Badge variant="outline" className="text-xs text-muted-foreground shrink-0">Vacant</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              BVSL: {group.bvslName || '—'} · {group.memberCount} members
            </p>
            {isVacant ? (
              <p className="text-xs text-muted-foreground italic">No members yet — share the join link to invite</p>
            ) : (
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold ${rateColor}`}>{group.attendanceRate}%</span>
                <span className="text-xs text-muted-foreground">
                  {group.presentCount}/{group.totalSessions} sessions
                </span>
                <Badge variant="outline" className={`text-xs ${rateColor} border-current`}>
                  {group.attendanceRate >= 75 ? 'Good' : group.attendanceRate >= 50 ? 'Fair' : 'Needs Attention'}
                </Badge>
              </div>
            )}
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
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

export default function GuideBvTab({ guideId, bvslMode, residencyIds }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupStat[]>([]);

  useEffect(() => { loadGroups(); }, [guideId]);

  const loadGroups = async () => {
    setLoading(true);
    try {
      const result = await getGuideGroupStats({ guideId, bvslMode, residencyIds: residencyIds && residencyIds.length > 0 ? residencyIds : undefined });
      setGroups(result.groups);
    } catch {
      toast.error('Failed to load BV groups');
    } finally {
      setLoading(false);
    }
  };

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
          <p className="text-sm mt-1">BV groups will appear here once BVSLs create them.</p>
        </CardContent>
      </Card>
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
