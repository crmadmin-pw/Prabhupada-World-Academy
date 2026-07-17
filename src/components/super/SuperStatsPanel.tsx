import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Users, Home, BookOpen, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { getGuides, getGuideUsers, getAllResidenciesWithStats } from 'zite-endpoints-sdk';
import type { GetGuidesOutputType } from 'zite-endpoints-sdk';

type GuideStat = GetGuidesOutputType['guides'][0] & { userCount: number; avgScore: number | null };

export default function SuperStatsPanel() {
  const [guideStats, setGuideStats] = useState<GuideStat[]>([]);
  const [totalHostels, setTotalHostels] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [{ guides }, hostels] = await Promise.all([
          getGuides({}),
          getAllResidenciesWithStats({}).catch(() => [] as any[]),
        ]);
        setTotalHostels((hostels as any[]).filter((h: any) => h.isActive).length);
        const stats = await Promise.all(
          guides.map(g =>
            getGuideUsers({ guideId: g.guideId, statusFilter: 'active' })
              .then(r => {
                const scored = r.users.filter(u => u.latestScore != null);
                const avg = scored.length > 0
                  ? Math.round(scored.reduce((s, u) => s + (u.latestScore || 0), 0) / scored.length)
                  : null;
                return { ...g, userCount: r.users.length, avgScore: avg };
              })
              .catch(() => ({ ...g, userCount: 0, avgScore: null as null }))
          )
        );
        setGuideStats(stats);
      } catch { toast.error('Failed to load stats'); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const totalUsers = guideStats.reduce((s, g) => s + g.userCount, 0);
  const overallAvg = guideStats.filter(g => g.avgScore != null).length > 0
    ? Math.round(guideStats.filter(g => g.avgScore != null).reduce((s, g) => s + (g.avgScore || 0), 0) / guideStats.filter(g => g.avgScore != null).length)
    : null;

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={<Users className="w-5 h-5 text-primary" />} label="Total Users" value={totalUsers} />
        <StatCard icon={<BookOpen className="w-5 h-5 text-blue-500" />} label="Total Guides" value={guideStats.length} />
        <StatCard icon={<Home className="w-5 h-5 text-green-600" />} label="Active Hostels" value={totalHostels} />
        <StatCard icon={<BarChart3 className="w-5 h-5 text-amber-500" />} label="Overall Avg Score" value={overallAvg != null ? `${overallAvg}%` : '—'} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Guide-wise Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guide</TableHead>
                <TableHead className="text-center">Active Users</TableHead>
                <TableHead className="text-center">Avg Sadhana Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guideStats.map(g => (
                <TableRow key={g.guideId}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-center"><Badge variant="secondary">{g.userCount}</Badge></TableCell>
                  <TableCell className="text-center">
                    {g.avgScore != null
                      ? <span className={`font-bold ${g.avgScore >= 80 ? 'text-green-600' : g.avgScore >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{g.avgScore}%</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
