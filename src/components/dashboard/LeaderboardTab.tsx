import { useMemo } from 'react';
import { Trophy, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import SadhanaLeaderboard from '@/components/dashboard/SadhanaLeaderboard';
import SectionErrorBoundary from '@/components/SectionErrorBoundary';
import { scoreColor } from '@/lib/scoring';

interface LeaderboardEntry {
  userId: string;
  displayName: string;
  guideName: string;
  guideId: string;
  ashrayLevel: string;
  isResident: boolean;
  residencyName: string;
  todayScore: number | null;
  scorePercent?: number | null;
  flagSick?: boolean;
  flagOs?: boolean;
  currentStreak?: number;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  currentUserResidency: string;
  currentUserAshrayLevel: string;
  currentUserGuideId: string;
  currentUserIsResident: boolean;
  folkTotals?: Record<string, number>;
}

interface FolkRank {
  folkName: string;
  submitted: number;
  totalMembers: number;
  avgScore: number;
  weightedScore: number;
  isUsersFolk: boolean;
}

const RANK_STYLES = [
  'bg-yellow-100 text-yellow-700 border-yellow-300',
  'bg-gray-100 text-gray-600 border-gray-300',
  'bg-orange-100 text-orange-600 border-orange-300',
];

function weightedColor(pct: number): string {
  if (pct >= 85) return 'text-green-700 font-bold';
  if (pct >= 60) return 'text-amber-600 font-bold';
  return 'text-red-600 font-bold';
}

interface Props {
  leaderboardData: LeaderboardData | null;
  userId: string;
  userResidencyName?: string;
}

export default function LeaderboardTab({ leaderboardData, userId, userResidencyName }: Props) {
  const folkRankings = useMemo((): FolkRank[] => {
    if (!leaderboardData) return [];
    const residents = leaderboardData.leaderboard.filter(e => e.isResident && e.residencyName);
    const folkTotals = leaderboardData.folkTotals ?? {};

    const groups = new Map<string, LeaderboardEntry[]>();
    for (const e of residents) {
      if (!groups.has(e.residencyName)) groups.set(e.residencyName, []);
      groups.get(e.residencyName)!.push(e);
    }

    const rows: FolkRank[] = [];
    for (const [folkName, members] of groups) {
      const scores = members.map(m => m.scorePercent ?? 0);
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
      // Total active members from backend; fall back to submitted count if not available
      const totalMembers = folkTotals[folkName] ?? members.length;
      // Weighted score = avg % × (submitted ÷ total members)
      const weightedScore = Math.round(avgScore * (members.length / totalMembers) * 10) / 10;
      rows.push({
        folkName: folkName.replace(/^FOLK\s+/i, ''),
        submitted: members.length,
        totalMembers,
        avgScore,
        weightedScore,
        isUsersFolk: folkName === userResidencyName,
      });
    }

    // Sort by weighted score — penalises low participation
    return rows.sort((a, b) => b.weightedScore - a.weightedScore);
  }, [leaderboardData, userResidencyName]);

  if (!leaderboardData) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Loading leaderboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* FOLK Residency Rankings */}
      {folkRankings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="text-base">FOLK Residency Rankings</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ranked by weighted score today · {folkRankings.length} FOLKs
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {folkRankings.map((folk, idx) => (
              <div
                key={folk.folkName}
                className={`flex items-center gap-3 px-4 py-2.5 border-b last:border-0 transition-colors ${
                  folk.isUsersFolk
                    ? 'bg-primary/10 border-l-4 border-l-primary'
                    : 'hover:bg-muted/30'
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${
                  idx < 3 ? RANK_STYLES[idx] : 'bg-muted text-muted-foreground border-border'
                }`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-sm font-semibold ${folk.isUsersFolk ? 'text-primary' : ''}`}>
                      {folk.folkName}
                    </span>
                    {folk.isUsersFolk && (
                      <Badge variant="outline" className="text-xs px-1.5 h-5 border-primary text-primary">
                        Your FOLK
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {folk.submitted}/{folk.totalMembers} submitted · Avg: {folk.avgScore}%
                  </p>
                </div>
                <div className={`text-sm ${weightedColor(folk.weightedScore)}`}>
                  {folk.weightedScore}%
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground px-4 py-2 border-t">
              Weighted Score = Avg % × (Submitted ÷ Total Members)
            </p>
          </CardContent>
        </Card>
      )}

      {/* Individual leaderboard */}
      <SectionErrorBoundary sectionName="Sadhana Leaderboard">
        <SadhanaLeaderboard
          leaderboard={leaderboardData.leaderboard}
          currentUserId={userId}
          currentUserGuideId={leaderboardData.currentUserGuideId}
          currentUserResidency={leaderboardData.currentUserResidency}
          currentUserAshrayLevel={leaderboardData.currentUserAshrayLevel}
          currentUserIsResident={leaderboardData.currentUserIsResident}
        />
      </SectionErrorBoundary>
    </div>
  );
}
