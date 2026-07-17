import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trophy, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfISOWeek, endOfISOWeek } from 'date-fns';
import type { GetBvAttendanceOutputType } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

type LeaderboardEntry = GetBvAttendanceOutputType['leaderboard'][0];

const PAGE_SIZE = 10;
const RANK_STYLES = [
  'bg-yellow-100 text-yellow-700 border-yellow-300',
  'bg-gray-100 text-gray-600 border-gray-300',
  'bg-orange-100 text-orange-600 border-orange-300',
];

interface Props {
  leaderboard: LeaderboardEntry[];
  currentUserId: string;
}

function getWeekRangeLabel(): string {
  const now = new Date();
  const start = startOfISOWeek(now);
  const end = endOfISOWeek(now);
  const startStr = format(start, 'MMM dd');
  const endStr = format(end, 'MMM dd, yyyy');
  return `${startStr} – ${endStr}`;
}

export default function BvLeaderboard({ leaderboard, currentUserId }: Props) {
  const { profile } = useUserProfile();
  const [ashrayFilter, setAshrayFilter] = useState<'all' | 'mine'>('all');
  const [residencyFilter, setResidencyFilter] = useState<'all' | 'mine'>('all');
  const [page, setPage] = useState(0);

  const currentUserAshrayLevel = profile?.ashrayLevel || '';
  const currentUserResidency = profile?.residencyName || '';
  // FIX: Use residencyName presence as the source of truth (consistent with profile & backend)
  const currentUserIsResident = !!profile?.residencyName;

  const weekRangeLabel = useMemo(() => getWeekRangeLabel(), []);

  const sorted = useMemo(() =>
    [...leaderboard].sort((a, b) => b.attendanceRate - a.attendanceRate),
    [leaderboard]
  );

  const filtered = useMemo(() => {
    let base = sorted;
    if (ashrayFilter === 'mine' && currentUserAshrayLevel)
      base = base.filter(e => e.ashrayLevel === currentUserAshrayLevel);
    if (residencyFilter === 'mine' && currentUserResidency)
      base = base.filter(e => e.residencyName === currentUserResidency);
    return base;
  }, [sorted, ashrayFilter, residencyFilter, currentUserAshrayLevel, currentUserResidency]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const myGlobalRank = filtered.findIndex(e => e.userId === currentUserId);
  const myPage = myGlobalRank >= 0 ? Math.floor(myGlobalRank / PAGE_SIZE) : -1;

  const setAshray = (v: 'all' | 'mine') => { setAshrayFilter(v); setPage(0); };
  const setResidency = (v: 'all' | 'mine') => { setResidencyFilter(v); setPage(0); };

  if (leaderboard.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <div>
              <CardTitle className="text-base">Weekly Bhakti Vriksha Leaderboard</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{weekRangeLabel}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent><p className="text-sm text-muted-foreground text-center py-4">No attendance data yet.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <div>
              <CardTitle className="text-base">Weekly Bhakti Vriksha Leaderboard</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{weekRangeLabel}</p>
            </div>
          </div>
          {myGlobalRank >= 0 && (
            <Button size="sm" variant="outline" className="text-xs h-7 shrink-0"
              onClick={() => myPage >= 0 && setPage(myPage)}>
              #{myGlobalRank + 1} My Position
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          <div className="flex gap-1">
            <Button size="sm" variant={ashrayFilter === 'all' ? 'default' : 'outline'} className="text-xs h-7"
              onClick={() => setAshray('all')}>All Ashraya</Button>
            {currentUserAshrayLevel && (
              <Button size="sm" variant={ashrayFilter === 'mine' ? 'default' : 'outline'} className="text-xs h-7"
                onClick={() => setAshray('mine')}>My Ashraya</Button>
            )}
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={residencyFilter === 'all' ? 'default' : 'outline'} className="text-xs h-7"
              onClick={() => setResidency('all')}>All Residencies</Button>
            {currentUserIsResident && currentUserResidency && (
              <Button size="sm" variant={residencyFilter === 'mine' ? 'default' : 'outline'} className="text-xs h-7"
                onClick={() => setResidency('mine')}>My Residency</Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No members match this filter.</p>
        ) : (
          <>
            <div className="divide-y">
              {pageEntries.map((entry, idx) => {
                const globalRank = page * PAGE_SIZE + idx;
                const isCurrentUser = entry.userId === currentUserId;
                const residencyLabel = entry.isResident && entry.residencyName
                  ? entry.residencyName
                  : 'Non-Resident';
                return (
                  <div key={entry.userId} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isCurrentUser ? 'bg-primary/5 border-l-2 border-primary' : 'hover:bg-muted/30'}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${globalRank < 3 ? RANK_STYLES[globalRank] : 'bg-muted text-muted-foreground border-border'}`}>{globalRank + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium truncate ${isCurrentUser ? 'text-primary' : ''}`}>
                          {entry.displayName}{isCurrentUser && <span className="text-xs font-normal ml-1">(You)</span>}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[entry.ashrayLevel, residencyLabel].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-green-600">{entry.attendanceRate}%</div>
                      <div className="text-[10px] text-muted-foreground">{entry.presentCount}/{entry.totalCount} sessions</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t">
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />Prev
                </Button>
                <span className="text-xs text-muted-foreground">
                  {page + 1} / {totalPages} · {filtered.length} members
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}>
                  Next<ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
