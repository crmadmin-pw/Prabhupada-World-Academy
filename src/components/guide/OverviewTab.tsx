import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, CheckCircle, XCircle, TrendingUp, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getGuideMetrics } from 'zite-endpoints-sdk';
import { THRESHOLDS } from '@/types/enums';
import StatCard from '@/shared/StatCard';

interface Props {
  guideId: string;
  onTabChange?: (tab: string) => void;
}

export default function OverviewTab({ guideId, onTabChange }: Props) {
  const [loading, setLoading] = useState(true);
  const [m, setM] = useState({ pendingApprovals: 0, activeUsers: 0, submissionsToday: 0, missingToday: 0, avgScore7d: 0, submissionRate7d: 0 });

  useEffect(() => { loadMetrics(); }, [guideId]);

  const loadMetrics = async () => {
    try {
      const r = await getGuideMetrics({ guideId });
      setM({ pendingApprovals: r.pendingApprovals ?? 0, activeUsers: r.activeUsers ?? 0,
        submissionsToday: r.submissionsToday ?? 0, missingToday: r.missingToday ?? 0,
        avgScore7d: r.avgScore7d ?? 0, submissionRate7d: r.submissionRate7d ?? 0 });
    } catch { toast.error('Failed to load overview metrics'); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32" />)}
    </div>
  );

  const rateLabel = m.submissionRate7d >= THRESHOLDS.nonResident.healthy ? 'Excellent!' : m.submissionRate7d >= THRESHOLDS.nonResident.moderate ? 'Good' : 'Needs attention';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={AlertCircle} value={m.pendingApprovals} label="Pending Approvals"
          sublabel={m.pendingApprovals === 0 ? 'No pending requests' : 'Awaiting your review'} />
        <StatCard icon={Users} iconColor="text-primary" value={m.activeUsers} label="Active Users" sublabel="Under your guidance" />
        <StatCard icon={CheckCircle} iconColor="text-green-600" value={m.submissionsToday} label="Submissions Today"
          sublabel={`of ${m.activeUsers} users (${m.activeUsers > 0 ? Math.round((m.submissionsToday / m.activeUsers) * 100) : 0}%)`} />
        <StatCard icon={XCircle} iconColor="text-destructive" value={m.missingToday} label="Missing Today"
          sublabel={m.missingToday === 0 ? 'All users submitted!' : 'Users not submitted'} />
        <StatCard icon={TrendingUp} value={m.avgScore7d > 0 ? `${m.avgScore7d}%` : '—'} label="Avg Score % (7d)" sublabel="Across all users" />
        <StatCard icon={TrendingUp} value={`${Math.round(m.submissionRate7d * 100)}%`} label="Submission Rate (7d)" sublabel={rateLabel} />
      </div>


    </div>
  );
}
