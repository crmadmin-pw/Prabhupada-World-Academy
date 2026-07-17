import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Flame, Users, Trophy, TrendingUp, AlertTriangle, ExternalLink, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getChallengeDashboard, GetChallengeDashboardOutputType } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';

type Challenge = GetChallengeDashboardOutputType['challenges'][0];

export default function ChallengeDashboardTab() {
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getChallengeDashboard({})
      .then(res => setChallenges(res.challenges))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (challenges.length === 0) {
    return <ChallengesEmptyState onNavigate={() => navigate('/attendance/manage')} />;
  }

  // Summary stats
  const totalEnrolled = challenges.reduce((s, c) => s + c.enrolledCount, 0);
  const totalActive = challenges.reduce((s, c) => s + c.activeCount, 0);
  const totalCompleted = challenges.reduce((s, c) => s + c.completedCount, 0);
  const activeChallenges = challenges.filter(c => c.activeCount > 0);

  return (
    <div className="space-y-6">
      {/* Header link to manage events */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/attendance/manage')}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          Manage Events <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={<Flame className="w-5 h-5 text-orange-500" />} label="Active Challenges" value={String(activeChallenges.length)} />
        <SummaryCard icon={<Users className="w-5 h-5 text-blue-500" />} label="Total Enrolled" value={String(totalEnrolled)} />
        <SummaryCard icon={<TrendingUp className="w-5 h-5 text-green-500" />} label="Active Participants" value={String(totalActive)} />
        <SummaryCard icon={<Trophy className="w-5 h-5 text-amber-500" />} label="Completed" value={String(totalCompleted)} />
      </div>

      {/* Challenge cards */}
      <div className="space-y-4">
        {challenges.map(c => (
          <ChallengeCard key={c.sessionId} challenge={c} />
        ))}
      </div>
    </div>
  );
}

function ChallengesEmptyState({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Zap className="w-7 h-7 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-lg mb-2">No Challenges Yet</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-1">
        Attach a streak challenge to any attendance session — participants who check in daily build a streak.
      </p>
      <p className="text-xs text-muted-foreground max-w-sm mb-5">
        To create a challenge, go to <span className="font-medium">Attendance Events</span>, open a session, and toggle <span className="font-medium">"Enable Challenge"</span>.
      </p>
      <Button onClick={onNavigate} className="gap-1.5">
        <ExternalLink className="w-4 h-4" /> Go to Attendance Events
      </Button>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChallengeCard({ challenge: c }: { challenge: Challenge }) {
  const isActive = c.activeCount > 0;

  return (
    <Card className={isActive ? 'border-primary/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Flame className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
            <div>
              <CardTitle className="text-base">{c.challengeTitle}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{c.name} · {c.challengeDays}-day challenge</p>
            </div>
          </div>
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? 'Active' : 'Ended'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
            <span>Completion Rate</span>
            <span className="font-medium">{c.completionRate}%</span>
          </div>
          <Progress value={c.completionRate} className="h-2" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatPill label="Enrolled" value={c.enrolledCount} />
          <StatPill label="Active" value={c.activeCount} color="text-blue-600" />
          <StatPill label="Completed" value={c.completedCount} color="text-green-600" />
          <StatPill label="Dropped" value={c.droppedCount} color="text-destructive" icon={c.droppedCount > 0 ? <AlertTriangle className="w-3 h-3" /> : undefined} />
          <StatPill label="Avg Streak" value={`${c.avgStreak}d`} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatPill({ label, value, color, icon }: { label: string; value: number | string; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2 text-center">
      <p className={`text-lg font-bold ${color || ''} flex items-center justify-center gap-1`}>
        {icon}{value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
