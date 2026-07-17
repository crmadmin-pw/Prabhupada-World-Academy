/**
 * GuideLeaderboardDisplay — card-style leaderboard for the Guide dashboard (individual users).
 * Filters: "All FOLK Residents" | "All Non-Residents" + Ashray Level dropdown
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trophy, ChevronLeft, ChevronRight } from 'lucide-react';
import { scoreColor } from '@/lib/scoring';

const PAGE_SIZE = 10;

const RANK_STYLES = [
  'bg-yellow-100 text-yellow-700 border-yellow-300',
  'bg-gray-100 text-gray-600 border-gray-300',
  'bg-orange-100 text-orange-600 border-orange-300',
];

const ASHRAY_LEVELS = [
  'Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka',
  'Upasaka', 'Caranashraya', 'Harinam Diksha',
];

type FilterKey = 'residents' | 'nr';

interface Entry {
  userId: string;
  displayName: string;
  ashrayLevel: string;
  isResident: boolean;
  residencyName: string;
  scorePercent: number | null;
  todayScore: number | null;
  flagSick?: boolean;
  flagOs?: boolean;
  currentStreak?: number;
}

interface Props {
  leaderboard: Entry[];
  dateLabel: string;
  totalDays?: number;
}

export default function GuideLeaderboardDisplay({ leaderboard, dateLabel }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('residents');
  const [ashrayFilter, setAshrayFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const setFilter = (f: FilterKey) => { setActiveFilter(f); setPage(0); };
  const setAshray = (v: string) => { setAshrayFilter(v); setPage(0); };

  let filtered = activeFilter === 'residents'
    ? leaderboard.filter(e => e.isResident)
    : leaderboard.filter(e => !e.isResident);

  if (ashrayFilter !== 'all') {
    filtered = filtered.filter(e => e.ashrayLevel === ashrayFilter);
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <div>
            <CardTitle className="text-base">Individual Sadhana Leaderboard</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{dateLabel}</p>
          </div>
        </div>

        {/* Filter chips + Ashray dropdown */}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Button size="sm" variant={activeFilter === 'residents' ? 'default' : 'outline'}
            className="text-xs h-7 whitespace-nowrap" onClick={() => setFilter('residents')}>
            All FOLK Residents
          </Button>
          <Button size="sm" variant={activeFilter === 'nr' ? 'default' : 'outline'}
            className="text-xs h-7 whitespace-nowrap" onClick={() => setFilter('nr')}>
            All Non-Residents
          </Button>
          <Select value={ashrayFilter} onValueChange={setAshray}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="Ashray Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ashray Levels</SelectItem>
              {ASHRAY_LEVELS.map(lvl => (
                <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No submissions yet for this date</p>
        ) : (
          <>
            <div className="divide-y">
              {pageEntries.map((entry, idx) => {
                const globalRank = page * PAGE_SIZE + idx;
                const residencyLabel = entry.isResident && entry.residencyName
                  ? entry.residencyName.replace(/^FOLK\s+/i, '')
                  : 'Non-Resident';
                return (
                  <div key={entry.userId}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${
                      globalRank < 3 ? RANK_STYLES[globalRank] : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      {globalRank + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{entry.displayName}</span>
                        {entry.flagSick && entry.flagOs && <span className="text-xs">🤒✈️</span>}
                        {entry.flagSick && !entry.flagOs && <span className="text-xs">🤒</span>}
                        {entry.flagOs && !entry.flagSick && <span className="text-xs">✈️</span>}
                        {(entry.currentStreak ?? 0) > 0 && (
                          <span className="text-xs font-semibold text-orange-600 whitespace-nowrap">🔥{entry.currentStreak}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {[entry.ashrayLevel, residencyLabel].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      {entry.scorePercent != null ? (
                        <div className={`text-sm font-bold ${scoreColor(entry.scorePercent, entry.isResident)}`}>
                          {entry.scorePercent}%
                        </div>
                      ) : entry.todayScore !== null ? (
                        <div className="text-sm font-bold text-primary">{entry.todayScore} pts</div>
                      ) : (
                        <div className="text-sm text-muted-foreground">—</div>
                      )}
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
                  {page + 1} / {totalPages} · {filtered.length} submitted
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}>
                  Next<ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground px-4 py-2 border-t">
              Ranking: Score › Ashray Level › Streak › Submission Time
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
