import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Star, TrendingUp, EyeOff, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { getServiceLeaderboard } from 'zite-endpoints-sdk';
import type { GetServiceLeaderboardOutputType } from 'zite-endpoints-sdk';

type Entry = GetServiceLeaderboardOutputType['entries'][0];
type Period = 'daily' | 'weekly' | 'monthly';

const MEDAL = ['🥇', '🥈', '🥉'];
const PERIOD_LABELS: Record<Period, string> = { daily: 'Today', weekly: 'This Week', monthly: 'This Month' };

function StarBar({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 items-center">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} className={`w-3 h-3 ${n <= Math.round(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/20'}`} />
      ))}
      <span className="text-xs font-semibold ml-1">{rating.toFixed(1)}</span>
    </div>
  );
}

function EntryRow({ entry, isGuide }: { entry: Entry; isGuide: boolean }) {
  const rankDisplay = MEDAL[entry.rank - 1] ?? `#${entry.rank}`;
  const nameDisplay = entry.name ?? `Rank ${entry.rank}`;
  const isMe = entry.isCurrentUser;

  return (
    <div className={`flex items-center gap-3 py-3 px-3 rounded-lg border ${isMe ? 'bg-primary/5 border-primary/30' : 'bg-card border-border'}`}>
      <div className="w-8 text-center text-lg font-bold shrink-0">{rankDisplay}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`font-medium text-sm truncate ${!entry.name ? 'text-muted-foreground italic' : ''}`}>
            {nameDisplay} {isMe && <span className="text-xs text-primary font-normal">(you)</span>}
          </p>
          {entry.completionRate < 80 && (
            <Badge variant="outline" className="text-[10px] py-0 border-orange-300 text-orange-600">Low completion</Badge>
          )}
        </div>
        <StarBar rating={entry.avgRating} />
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <p className="text-xs text-muted-foreground">{entry.completedCount} services</p>
        {isGuide && <p className="text-xs text-muted-foreground">{entry.completionRate}% rate</p>}
      </div>
    </div>
  );
}

interface Props {
  residencyId?: string;
  isGuide?: boolean;
}

export default function ServiceLeaderboardTab({ isGuide = false }: Props) {
  const [period, setPeriod] = useState<Period>('weekly');
  const [data, setData] = useState<GetServiceLeaderboardOutputType | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { load(); }, [period]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getServiceLeaderboard({ period });
      setData(res);
    } catch { toast.error('Failed to load leaderboard'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* My stats card */}
      {data && data.myRank && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Trophy className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Your Rank</p>
                <p className="text-xs text-muted-foreground">{PERIOD_LABELS[period]}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">#{data.myRank}</p>
              {data.myAvgRating && <StarBar rating={data.myAvgRating} />}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-500" />
              Service Leaderboard
            </CardTitle>
            <div className="flex gap-1">
              {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
                <Button
                  key={p}
                  size="sm"
                  variant={period === p ? 'default' : 'outline'}
                  className="h-7 text-xs px-3"
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABELS[p]}
                </Button>
              ))}
            </div>
          </div>
          {!isGuide && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
              <EyeOff className="w-3 h-3" />
              Names are private — rankings based on anonymous peer ratings
            </p>
          )}
          {data && (
            <p className="text-xs text-muted-foreground">{data.dateRange} · {data.totalRatings} peer ratings collected</p>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          ) : !data || data.entries.length === 0 ? (
            <div className="text-center py-10">
              <BarChart2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">No leaderboard data yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Leaderboard appears after at least 3 peer ratings are collected per resident
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.entries.map(entry => (
                <EntryRow key={`${entry.rank}-${entry.userId}`} entry={entry} isGuide={isGuide} />
              ))}
              {!isGuide && data.entries.length > 0 && (
                <p className="text-xs text-center text-muted-foreground pt-2">
                  Only top 3 rankings are visible to residents 🙏
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
