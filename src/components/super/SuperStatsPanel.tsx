import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Users, Home, BookOpen, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { getGuides, getGuideUsers, getAllResidenciesWithStats } from '@/lib/endpoints-sdk';
import type { GetGuidesOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

type GuideStat = GetGuidesOutputType['guides'][0] & { userCount: number; avgScore: number | null };
type Guide = GetGuidesOutputType['guides'][0];
type AssignedUser = {
  selectedGuideId?: unknown;
  selectedGuideName?: unknown;
  guideId?: unknown;
  guide?: unknown;
  mentorId?: unknown;
  mentorName?: unknown;
  bvReportingAdminId?: unknown;
  bvReportingAdminName?: unknown;
};

const ADMIN_IDENTITY_NOISE = new Set([
  'admin', 'administrator', 'das', 'guide', 'mentor', 'prabhu', 'pw', 'super',
]);

/**
 * Admin assignments have historically been stored as document IDs, user IDs,
 * email addresses, display names, and legacy aliases such as
 * MENTOR-PW-HIRANYAVARNA. Produce both exact and semantic keys so all of those
 * formats resolve to the same current admin without relying on stale hierarchy
 * fields.
 */
function getAdminIdentityKeys(...values: unknown[]): string[] {
  const keys = new Set<string>();

  for (const value of values) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) continue;

    keys.add(normalized);
    keys.add(normalized.replace(/[^a-z0-9]/g, ''));

    const semantic = normalized
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 0 && !ADMIN_IDENTITY_NOISE.has(token))
      .join('');
    if (semantic.length >= 4) keys.add(semantic);
  }

  return [...keys].filter(Boolean);
}

function resolveAssignedAdmin(user: AssignedUser, adminsByIdentity: Map<string, Guide>): Guide | undefined {
  const findMatch = (values: unknown[]) => {
    for (const key of getAdminIdentityKeys(...values)) {
      const admin = adminsByIdentity.get(key);
      if (admin) return admin;
    }
    return undefined;
  };

  // The Admin dropdown writes the user's guide assignment. It is the current,
  // user-visible source of truth and must win over legacy BV hierarchy fields.
  return findMatch([
    user.selectedGuideId,
    user.selectedGuideName,
    user.guideId,
    user.guide,
    user.mentorId,
    user.mentorName,
  ]) || findMatch([
    user.bvReportingAdminId,
    user.bvReportingAdminName,
  ]);
}

interface SuperStatsPanelProps {
  segment?: 'PW' | 'FOLK';
  isActive?: boolean; // true when this tab is currently visible
}

export default function SuperStatsPanel({ segment, isActive }: SuperStatsPanelProps) {
  const { profile } = useUserProfile();
  const effectiveSegment = segment || profile?.segment || (profile?.isPrabhupadaWorldUser === true ? 'PW' : 'FOLK');
  const isPw = effectiveSegment === 'PW';

  const [guideStats, setGuideStats] = useState<GuideStat[]>([]);
  const [totalHostels, setTotalHostels] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useReactiveLoader(async (read, showLoading = true) => {
    if (showLoading) !read.background && setLoading(true);
    try {
      const [{ guides }, hostels] = await Promise.all([
        read(() => getGuides({ segment: effectiveSegment })),
        read(() => getAllResidenciesWithStats({})).catch(() => [] as any[]),
      ]);
      setTotalHostels((hostels as any[]).filter((h: any) => h.isActive).length);

      let stats: GuideStat[];

      if (isPw) {
        // Fetch all active users once and group them by the current Admin
        // dropdown assignment, with the BV reporting hierarchy as a fallback
        // for older records that do not yet have a guide assignment.
        const allUsersRes = await read(() => getGuideUsers({ guideId: 'ALL', statusFilter: 'active' })).catch(() => ({ users: [] }));
        const allUsers: any[] = allUsersRes.users;

        const adminsByIdentity = new Map<string, Guide>();
        for (const admin of guides) {
          for (const key of getAdminIdentityKeys(admin.guideId, admin.email, admin.name)) {
            adminsByIdentity.set(key, admin);
          }
        }

        const usersByAdmin = new Map<string, any[]>();
        for (const u of allUsers) {
          const assignedAdmin = resolveAssignedAdmin(u, adminsByIdentity);
          const adminId = assignedAdmin?.guideId;
          if (!adminId) continue;
          if (!usersByAdmin.has(adminId)) usersByAdmin.set(adminId, []);
          usersByAdmin.get(adminId)!.push(u);
        }

        stats = guides.map((g: any) => {
          const users = usersByAdmin.get(g.guideId) || [];
          const scored = users.filter((u: any) => u.latestScore != null);
          const avg = scored.length > 0
            ? Math.round(scored.reduce((s: number, u: any) => s + (u.latestScore || 0), 0) / scored.length)
            : null;
          return { ...g, userCount: users.length, avgScore: avg };
        });
      } else {
        // For FOLK, users are linked via the Guides table — original approach works fine
        stats = await Promise.all(
          guides.map((g: any) =>
            read(() => getGuideUsers({ guideId: g.guideId, statusFilter: 'active' }))
              .then(r => {
                const scored = r.users.filter((u: any) => u.latestScore != null);
                const avg = scored.length > 0
                  ? Math.round(scored.reduce((s: number, u: any) => s + (u.latestScore || 0), 0) / scored.length)
                  : null;
                return { ...g, userCount: r.users.length, avgScore: avg };
              })
              .catch(() => ({ ...g, userCount: 0, avgScore: null as null }))
          )
        );
      }

      setGuideStats(stats);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load stats'); }
    finally { setLoading(false); }
  }, []);


  useEffect(() => {
    loadData();
  }, [isPw]);

  // Re-fetch silently every time the stats tab becomes visible
  useEffect(() => {
    if (isActive) loadData(false);
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalUsers = guideStats.reduce((s, g) => s + g.userCount, 0);
  const overallAvg = guideStats.filter(g => g.avgScore != null).length > 0
    ? Math.round(guideStats.filter(g => g.avgScore != null).reduce((s, g) => s + (g.avgScore || 0), 0) / guideStats.filter(g => g.avgScore != null).length)
    : null;

  if (loading) return <div className="space-y-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${isPw ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
        <StatCard icon={<Users className="w-5 h-5 text-primary" />} label="Total Users" value={totalUsers} />
        <StatCard icon={<BookOpen className="w-5 h-5 text-blue-500" />} label={isPw ? "Total Admins" : "Total Guides"} value={guideStats.length} />
        {!isPw && <StatCard icon={<Home className="w-5 h-5 text-green-600" />} label="Active Hostels" value={totalHostels} />}
        <StatCard icon={<BarChart3 className="w-5 h-5 text-amber-500" />} label="Overall Avg Score" value={overallAvg != null ? `${overallAvg}%` : '—'} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{isPw ? "Admin-wise Breakdown" : "Guide-wise Breakdown"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{isPw ? "Admin / Mentor" : "Guide"}</TableHead>
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
