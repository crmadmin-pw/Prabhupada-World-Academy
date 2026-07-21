import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trophy, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { format, startOfISOWeek, endOfISOWeek, getISOWeek } from 'date-fns';
import { scoreColor } from '@/lib/scoring';

const PAGE_SIZE = 10;
const RANK_STYLES = [
  'bg-yellow-100 text-yellow-700 border-yellow-300',
  'bg-gray-100 text-gray-600 border-gray-300',
  'bg-orange-100 text-orange-600 border-orange-300',
];

type FilterKey = 'all_residents' | 'my_folk' | 'all_ashray' | 'my_ashray' | 'all_nr' | 'nr_my_ashray';

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

interface Props {
  leaderboard: LeaderboardEntry[];
  currentUserId: string;
  currentUserGuideId: string;
  currentUserResidency: string;
  currentUserAshrayLevel: string;
  currentUserIsResident: boolean;
}

function getDefaultFilter(isResident: boolean): FilterKey {
  return isResident ? 'all_residents' : 'all_nr';
}

export default function SadhanaLeaderboard({
  leaderboard,
  currentUserId,
  currentUserGuideId,
  currentUserAshrayLevel,
  currentUserResidency,
  currentUserIsResident,
}: Props) {
  const defaultFilter = getDefaultFilter(currentUserIsResident);
  const [activeFilter, setActiveFilter] = useState<FilterKey>(defaultFilter);
  const [page, setPage] = useState(0);

  const now = new Date();
  const wkStart = startOfISOWeek(now);
  const wkEnd = endOfISOWeek(now);
  const todayLabel = `Week ${getISOWeek(now)}: ${format(wkStart, 'MMM dd')} – ${format(wkEnd, 'MMM dd')}`;
  const dateLabel = format(now, 'MMM dd, yyyy');

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'all_residents':
      case 'all_ashray':
        return leaderboard.filter(e => e.isResident);
      case 'my_folk':
        return leaderboard.filter(e => e.isResident && e.residencyName === currentUserResidency);
      case 'my_ashray':
        return leaderboard.filter(e => e.isResident && e.ashrayLevel === currentUserAshrayLevel);
      case 'all_nr':
        return leaderboard.filter(e => !e.isResident);
      case 'nr_my_ashray':
        return leaderboard.filter(e => !e.isResident && e.ashrayLevel === currentUserAshrayLevel);
      default:
        return leaderboard;
    }
  }, [leaderboard, activeFilter, currentUserResidency, currentUserAshrayLevel]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageEntries = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const myFilteredIdx = filtered.findIndex(e => e.userId === currentUserId);
  const myGlobalIdx = leaderboard.findIndex(e => e.userId === currentUserId);
  const myPage = myFilteredIdx >= 0 ? Math.floor(myFilteredIdx / PAGE_SIZE) : -1;

  const setFilter = (f: FilterKey) => { setActiveFilter(f); setPage(0); };

  const jumpToMyPosition = () => {
    if (myPage >= 0) setPage(myPage);
    else { setFilter(getDefaultFilter(currentUserIsResident)); setPage(0); }
  };

  // Chips shown depend on whether the current user is a resident or NR
  const residentChips: { key: FilterKey; label: string; disabled?: boolean; title?: string }[] = [
    { key: 'all_residents', label: 'All FOLK Residents' },
    {
      key: 'my_folk',
      label: 'My FOLK',
      disabled: !currentUserResidency,
      title: !currentUserResidency ? 'No FOLK residency set' : undefined,
    },
    { key: 'all_ashray', label: 'All Ashraya Levels' },
    {
      key: 'my_ashray',
      label: 'My Ashraya Level',
      disabled: !currentUserAshrayLevel,
      title: !currentUserAshrayLevel ? 'Ashraya level not set' : undefined,
    },
  ];

  const isPrabhupadaWorld = !currentUserIsResident ||
    String(currentUserGuideId || '').toUpperCase().includes('HIRANYAVARNA') ||
    String(currentUserGuideId || '').toUpperCase().includes('PW') ||
    String(currentUserGuideId || '') === 'MENTOR-PW-HIRANYAVARNA';

  const nrChips: { key: FilterKey; label: string; disabled?: boolean; title?: string }[] = [
    { key: 'all_nr', label: isPrabhupadaWorld ? 'All Members' : 'All Non-Residents' },
    {
      key: 'nr_my_ashray',
      label: 'My Ashraya',
      disabled: !currentUserAshrayLevel,
      title: !currentUserAshrayLevel ? 'Ashraya level not set' : undefined,
    },
  ];

  const chips = currentUserIsResident ? residentChips : nrChips;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <div>
              <CardTitle className="text-base">Daily Sadhana Leaderboard</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{dateLabel} · {todayLabel}</p>
            </div>
          </div>
          {myGlobalIdx >= 0 && (
            <Button
              size="sm"
              variant="default"
              className="text-xs h-7 shrink-0 gap-1"
              onClick={jumpToMyPosition}
            >
              <MapPin className="w-3 h-3" />
              #{myFilteredIdx >= 0 ? myFilteredIdx + 1 : myGlobalIdx + 1} My Position
            </Button>
          )}
        </div>

        {/* Filter chips — single row, scrollable on mobile */}
        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5 -mx-1 px-1">
          {chips.map(chip => (
            <Button
              key={chip.key}
              size="sm"
              variant={activeFilter === chip.key ? 'default' : 'outline'}
              className="text-xs h-7 whitespace-nowrap shrink-0"
              disabled={chip.disabled}
              title={chip.title}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No submissions yet today</p>
        ) : (
          <>
            <div className="divide-y">
              {pageEntries.map((entry, idx) => {
                const globalRank = page * PAGE_SIZE + idx;
                const isMe = entry.userId === currentUserId;
                const residencyLabel = entry.isResident && entry.residencyName
                  ? entry.residencyName
                  : 'Non-Resident';
                return (
                  <div key={entry.userId}
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      isMe
                        ? 'bg-primary/10 border-l-4 border-primary'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${
                      globalRank < 3 ? RANK_STYLES[globalRank] : 'bg-muted text-muted-foreground border-border'
                    }`}>{globalRank + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-sm font-medium truncate ${isMe ? 'text-primary font-semibold' : ''}`}>
                          {entry.displayName}
                          {isMe && <span className="text-xs font-normal ml-1 bg-primary text-primary-foreground px-1 py-0.5 rounded">You</span>}
                        </span>
                        {entry.flagSick && entry.flagOs && <span title="Sick & Out of Station" className="text-xs">🤒✈️</span>}
                        {entry.flagSick && !entry.flagOs && <span title="Sick" className="text-xs">🤒</span>}
                        {entry.flagOs && !entry.flagSick && <span title="Out of Station" className="text-xs">✈️</span>}
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
                        <div className={`text-sm font-bold ${scoreColor(entry.scorePercent, entry.isResident)}`}>{entry.scorePercent}%</div>
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
                  {page + 1} / {totalPages} · {filtered.length} members
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}>
                  Next<ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground px-4 py-2 border-t">
              Ranking Criteria: Sadhana Score › Ashray Level › Streak Count › Submission Time
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
