import { useState, useMemo, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Calendar as CalendarIcon, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { getUserHistory } from 'zite-endpoints-sdk';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { useUserProfile } from '@/contexts/UserProfileContext';
import EntryDetailModal from '@/components/dashboard/EntryDetailModal';
import { useQuery } from '@/hooks/useQuery';

// Memoized entry row — only re-renders when the entry changes
const EntryRow = memo(({ entry, onClick }: {
  entry: any;
  onClick: (date: string) => void;
}) => (
  <div
    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent cursor-pointer transition-colors"
    onClick={() => onClick(entry.entryDate)}
  >
    <div className="flex items-center gap-3">
      <div className="text-center min-w-[40px]">
        <div className="text-xs text-muted-foreground">{format(new Date(entry.entryDate), 'MMM')}</div>
        <div className="text-lg font-bold leading-tight">{format(new Date(entry.entryDate), 'dd')}</div>
        <div className="text-xs text-muted-foreground">{format(new Date(entry.entryDate), 'yyyy')}</div>
      </div>
      <div>
        <div className="font-medium">{format(new Date(entry.entryDate), 'EEEE')}</div>
        <div className="text-sm text-muted-foreground">
          Score: <span className="font-semibold text-primary">
            {entry.scorePercent != null ? `${entry.scorePercent}%` : entry.totalScore}
          </span>
        </div>
      </div>
    </div>
    <div className="flex items-center gap-2">
      {entry.flagSick && <Badge variant="outline" className="text-xs">Sick</Badge>}
      {entry.flagOs && <Badge variant="outline" className="text-xs">OS</Badge>}
    </div>
  </div>
));

// Memoized calendar day
const CalendarDay = memo(({ day, entry, isToday, isFuture, onClick }: {
  day: Date;
  entry: any;
  isToday: boolean;
  isFuture: boolean;
  onClick: (date: string) => void;
}) => {
  const dateStr = format(day, 'yyyy-MM-dd');
  return (
    <div
      className={`p-1 text-center rounded border min-h-[52px] flex flex-col justify-between text-xs ${
        isFuture
          ? 'bg-muted/50 text-muted-foreground/50'
          : entry
          ? 'bg-primary text-primary-foreground font-bold cursor-pointer hover:opacity-80'
          : 'bg-muted text-muted-foreground cursor-pointer hover:bg-muted/80'
      } ${isToday ? 'ring-2 ring-primary ring-offset-1' : ''}`}
      onClick={() => !isFuture && onClick(dateStr)}
    >
      <div>{format(day, 'd')}</div>
      {entry && (
        <>
          <div className="font-bold text-sm">
            {entry.scorePercent != null ? `${entry.scorePercent}%` : entry.totalScore}
          </div>
          <div className="flex gap-0.5 justify-center">
            {entry.flagSick && <span>🤒</span>}
            {entry.flagOs && <span>✈️</span>}
          </div>
        </>
      )}
    </div>
  );
});

export default function HistoryPage() {
  const { profile } = useUserProfile();
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 60;

  const { data: historyResult, loading } = useQuery({
    key: profile?.userId ? `history90:${profile.userId}:${page}` : null,
    fetcher: () => getUserHistory({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });

  const entries = useMemo(() => {
    return ((historyResult as any)?.entries || []).map((e: any) => ({
      entryId: e.entryId ?? '',
      entryDate: e.entryDate ?? '',
      totalScore: e.totalScore ?? 0,
      scorePercent: e.scorePercent ?? null,
      maxScore: e.maxScore ?? null,
      submittedAt: e.submittedAt ?? '',
      flagSick: e.flagSick ?? false,
      flagOs: e.flagOs ?? false,
    }));
  }, [historyResult]);

  // Build a Map for O(1) calendar lookup
  const entryByDate = useMemo(() => {
    const map = new Map<string, any>();
    entries.forEach((e: any) => { if (e.entryDate) map.set(e.entryDate, e); });
    return map;
  }, [entries]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentMonth]);

  const firstDayOfWeek = useMemo(() => (calendarDays[0].getDay() + 6) % 7, [calendarDays]);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const handleDayClick = useCallback((date: string) => {
    navigate(`/sadhana?date=${date}`);
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="container mx-auto max-w-6xl">
          <Skeleton className="h-12 w-64 mb-6" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const hasMore = (historyResult as any)?.hasMore;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-6xl">
        {/* P4-007 FIX: Smart back navigation */}
        <Button variant="ghost" onClick={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            if (profile?.role === 'BVSL' || profile?.isBvsl) navigate('/bvsl/dashboard');
            else if (profile?.role === 'SADHANA_MENTOR' || profile?.isSadhanaMentor) navigate('/mentor/dashboard');
            else navigate('/user/dashboard');
          }
        }} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Dashboard
        </Button>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Calendar View */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="w-5 h-5" />Calendar View
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="text-sm font-medium min-w-[120px] text-center">
                    {format(currentMonth, 'MMMM yyyy')}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentMonth(m => addMonths(m, 1))}
                    disabled={currentMonth >= new Date()}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <CardDescription>Your submission history</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground p-1">{day}</div>
                ))}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {calendarDays.map(day => {
                  const ds = format(day, 'yyyy-MM-dd');
                  return (
                    <CalendarDay
                      key={ds}
                      day={day}
                      entry={entryByDate.get(ds)}
                      isToday={ds === todayStr}
                      isFuture={day > new Date()}
                      onClick={handleDayClick}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* List View with pagination */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />Recent Entries
              </CardTitle>
              <CardDescription>Chronological list of submissions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {entries.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg font-medium mb-2">No sadhana entries yet</p>
                    <p className="text-sm mb-6">Your daily sadhana reports will appear here after you submit them.</p>
                    <Button onClick={() => navigate('/sadhana')}>Submit Today's Sadhana</Button>
                  </div>
                ) : (
                  entries.map((entry: any) => (
                    <EntryRow key={entry.entryId || entry.entryDate} entry={entry} onClick={handleDayClick} />
                  ))
                )}
              </div>
              {/* Pagination */}
              <div className="flex justify-between items-center mt-4 pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />Newer
                </Button>
                <span className="text-sm text-muted-foreground">Page {page + 1}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                >
                  Older<ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {profile?.userId && (
        <EntryDetailModal
          userId={profile.userId}
          entryDate={selectedDate}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
