import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Users, CheckCircle2, Brain } from 'lucide-react';
import { toast } from 'sonner';
import { getBvGroupDetail, getBvAttendanceMatrix } from 'zite-endpoints-sdk';
import type { GetBvGroupDetailOutputType, GetBvAttendanceMatrixOutputType } from 'zite-endpoints-sdk';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { Calendar } from 'lucide-react';
import { DashboardLayout } from '@/layouts';

type GroupDetail = GetBvGroupDetailOutputType;
type MatrixData = GetBvAttendanceMatrixOutputType;
type WeekFilter = 'this_week' | 'prev_week' | 'custom';

function getWeekRange(type: 'this_week' | 'prev_week'): { start: string; end: string } {
  const today = new Date();
  const base = type === 'prev_week' ? subWeeks(today, 1) : today;
  const mon = startOfWeek(base, { weekStartsOn: 1 });
  const sun = endOfWeek(base, { weekStartsOn: 1 });
  return { start: format(mon, 'yyyy-MM-dd'), end: format(sun, 'yyyy-MM-dd') };
}

function StatCard({ icon: Icon, label, value, sub, color = 'text-primary' }: {
  icon: any; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function AttendanceMatrix({ matrix, dates }: { matrix: MatrixData; dates: string[] }) {
  if (matrix.rows.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No attendance records found.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted border-b sticky top-0 z-10">
            <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-muted z-10 min-w-[140px]">Member</th>
            {dates.map(d => (
              <th key={d} className="text-center px-2 py-2 font-medium whitespace-nowrap min-w-[64px]">
                {format(new Date(d.slice(0, 10) + 'T00:00:00'), 'MMM d')}
              </th>
            ))}
            <th className="text-center px-2 py-2 font-bold bg-muted sticky right-0 z-10 min-w-[56px] border-l">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map(row => (
            <tr key={row.userId} className="border-b hover:bg-muted/30">
              <td className="px-3 py-2 font-medium sticky left-0 bg-card z-10 whitespace-nowrap">
                {row.name}
                {row.ashrayLevel && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">({row.ashrayLevel})</span>
                )}
              </td>
              {dates.map(d => {
                const val = row.attendance[d] ?? 0;
                return (
                  <td key={d} className={`text-center px-2 py-2 font-mono font-bold ${val === 1 ? 'text-green-600 bg-green-50' : 'text-muted-foreground'}`}>
                    {val === 1 ? '✓' : '—'}
                  </td>
                );
              })}
              <td className="text-center px-2 py-2 font-bold border-l sticky right-0 bg-card z-10">
                {row.weekTotal}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersTab({ members, onUserClick }: { members: GroupDetail['members']; onUserClick: (userId: string) => void }) {
  if (members.length === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <Users className="w-10 h-10 mx-auto text-muted-foreground opacity-40" />
        <p className="text-sm font-medium text-muted-foreground">No members yet</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted border-b">
            <th className="text-left px-3 py-2.5 font-semibold">Name</th>
            <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">Ashray Level</th>
            <th className="text-center px-3 py-2.5 font-semibold">Present</th>
            <th className="text-center px-3 py-2.5 font-semibold">Sessions</th>
            <th className="text-center px-3 py-2.5 font-semibold">Rate</th>
            <th className="text-left px-3 py-2.5 font-semibold hidden md:table-cell">Last Present</th>
            <th className="text-left px-3 py-2.5 font-semibold hidden lg:table-cell">Role</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.userId} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onUserClick(m.userId)}>
              <td className="px-3 py-2.5 font-medium">{m.fullName}</td>
              <td className="px-3 py-2.5 hidden sm:table-cell">
                {m.ashrayLevel
                  ? <Badge variant="outline" className="text-xs">{m.ashrayLevel}</Badge>
                  : <span className="text-muted-foreground text-xs">—</span>}
              </td>
              <td className="px-3 py-2.5 text-center text-green-600 font-semibold">{m.presentCount}</td>
              <td className="px-3 py-2.5 text-center">{m.totalCount}</td>
              <td className="px-3 py-2.5 text-center">
                <Badge variant="outline" className={`text-xs ${m.attendanceRate >= 75 ? 'border-green-400 text-green-700' : m.attendanceRate >= 50 ? 'border-yellow-400 text-yellow-700' : 'border-red-300 text-red-600'}`}>
                  {m.attendanceRate}%
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-muted-foreground text-xs hidden md:table-cell">
                {m.lastPresent ? format(new Date((m.lastPresent as string).slice(0, 10) + 'T00:00:00'), 'MMM d, yyyy') : '—'}
              </td>
              <td className="px-3 py-2.5 hidden lg:table-cell">
                {m.role === 'Leader'
                  ? <Badge className="text-xs bg-primary/10 text-primary border-primary/20">Leader</Badge>
                  : <span className="text-xs text-muted-foreground">Member</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function QuizzesTab({ quizzes }: { quizzes: Array<{ quizId: string; title: string; createdAt: string }> }) {
  if (quizzes.length === 0) {
    return (
      <div className="text-center py-10">
        <Brain className="w-10 h-10 mx-auto text-muted-foreground opacity-40 mb-2" />
        <p className="text-sm text-muted-foreground">No quizzes assigned to this group yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {quizzes.map(q => (
        <div key={q.quizId} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
          <Brain className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{q.title}</p>
            {q.createdAt && (
              <p className="text-xs text-muted-foreground">
                Created {format(new Date(q.createdAt), 'MMM d, yyyy')}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BvGroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [matrix, setMatrix] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekFilter, setWeekFilter] = useState<WeekFilter>('this_week');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const dateRange = useMemo(() => {
    if (weekFilter === 'custom' && customStart && customEnd) {
      return { start: customStart, end: customEnd };
    }
    return getWeekRange(weekFilter === 'prev_week' ? 'prev_week' : 'this_week');
  }, [weekFilter, customStart, customEnd]);

  useEffect(() => { if (groupId) load(); }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    getBvAttendanceMatrix({ groupId })
      .then(setMatrix)
      .catch(() => {});
  }, [groupId]);

  const load = async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const detailRes = await getBvGroupDetail({ groupId });
      setDetail(detailRes);
    } catch {
      toast.error('Failed to load group details');
    } finally {
      setLoading(false);
    }
  };

  const overallRate = useMemo(() => {
    if (!detail || detail.members.length === 0) return 0;
    const total = detail.members.reduce((s, m) => s + m.totalCount, 0);
    const present = detail.members.reduce((s, m) => s + m.presentCount, 0);
    return total > 0 ? Math.round((present / total) * 100) : 0;
  }, [detail]);

  const activeDates = useMemo(() => {
    if (!matrix) return [];
    return matrix.dates.filter(d => matrix.rows.some(r => r.attendance[d] === 1));
  }, [matrix]);

  if (loading) {
    return (
      <DashboardLayout title="BV Group" maxWidth="max-w-5xl" showProfile={false}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-7 w-48" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    );
  }

  if (!detail?.group) {
    return (
      <DashboardLayout title="BV Group" maxWidth="max-w-5xl" showProfile={false}>
        <div className="text-center py-12 text-muted-foreground">
          <p>Group not found.</p>
          <Button variant="link" onClick={() => navigate(-1)}>Go back</Button>
        </div>
      </DashboardLayout>
    );
  }

  const dd = detail as any;
  const quizzes = dd.quizzes ?? [];

  return (
    <DashboardLayout title="BV Group" maxWidth="max-w-5xl" showProfile={false}>
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>

        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold">{detail.group.groupName}</h2>
            {detail.group.isActive
              ? <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">Active</Badge>
              : <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
          </div>
          {detail.group.description && (
            <p className="text-muted-foreground text-sm mt-1">{detail.group.description}</p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={Users} label="Members" value={detail.members.length} sub="in this group" />
          <StatCard icon={CheckCircle2} label="Attendance Rate" value={`${overallRate}%`} sub="all-time average" color="text-green-600" />
          <StatCard icon={Brain} label="Quizzes" value={quizzes.length} sub="assigned quizzes" color="text-purple-600" />
        </div>

        <Tabs defaultValue="quizzes">
          <TabsList className="w-full md:w-auto">
            <TabsTrigger value="quizzes" className="flex items-center gap-1.5">
              <Brain className="w-4 h-4" />Quizzes
            </TabsTrigger>
            <TabsTrigger value="attendance" className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />Attendance
            </TabsTrigger>
            <TabsTrigger value="members" className="flex items-center gap-1.5">
              <Users className="w-4 h-4" />Members
            </TabsTrigger>
          </TabsList>

          <TabsContent value="quizzes" className="mt-4">
            <QuizzesTab quizzes={quizzes} />
          </TabsContent>

          <TabsContent value="attendance" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-primary" />Attendance Matrix
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    {(['this_week', 'prev_week', 'custom'] as WeekFilter[]).map(f => (
                      <Button key={f} size="sm" variant={weekFilter === f ? 'default' : 'outline'} className="h-7 text-xs"
                        onClick={() => setWeekFilter(f)}>
                        {f === 'this_week' ? 'This Week' : f === 'prev_week' ? 'Prev Week' : 'Custom'}
                      </Button>
                    ))}
                  </div>
                </div>
                {weekFilter === 'custom' && (
                  <div className="flex gap-3 flex-wrap mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">From</span>
                      <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-36 h-8" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">To</span>
                      <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-36 h-8" />
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {matrix ? (
                  <AttendanceMatrix matrix={matrix} dates={activeDates} />
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Loading attendance data...</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="members" className="mt-4">
            <MembersTab
              members={detail.members}
              onUserClick={(uid) => navigate(`/guide/users/${uid}`)}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
