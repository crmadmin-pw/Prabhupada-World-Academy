import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Flame, Calendar, ClipboardCheck, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isBefore, startOfDay } from 'date-fns';
import { getUserAttendanceCalendar } from 'zite-endpoints-sdk';
import { fmt } from '@/lib/fmt';

interface Props { userId: string; }

export default function AttendanceTab({ userId }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    getUserAttendanceCalendar({}).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const stats = data?.stats || {};
  const entries = data?.entries || [];
  const attendedDates = new Set<string>(entries.map((e: any) => e.date as string));

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <CalendarDays className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-bold text-primary">{stats.totalDaysAttended || 0}</p>
          <p className="text-xs text-muted-foreground">Sessions Attended</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Flame className="w-4 h-4 text-orange-500" />
          </div>
          <p className="text-2xl font-bold text-orange-500">{stats.currentStreak || 0}</p>
          <p className="text-xs text-muted-foreground">Current Streak</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Calendar className="w-4 h-4 text-primary" />
          </div>
          <p className="text-2xl font-bold">{stats.thisMonthCount || 0}</p>
          <p className="text-xs text-muted-foreground">This Month</p>
        </CardContent></Card>
      </div>

      {/* Calendar heatmap */}
      <AttendanceCalendar
        attendedDates={attendedDates}
        currentMonth={currentMonth}
        onMonthChange={setCurrentMonth}
      />

      {/* Recent entries */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" /> Recent Attendance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No attendance records yet</p>
          ) : (
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {entries.slice(0, 20).map((e: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{e.sessionName || 'Session'}</p>
                    <p className="text-xs text-muted-foreground">{e.eventTitle}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{fmt.date(e.date)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceCalendar({ attendedDates, currentMonth, onMonthChange }: {
  attendedDates: Set<string>;
  currentMonth: Date;
  onMonthChange: (d: Date) => void;
}) {
  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const firstDayOfWeek = (calendarDays[0].getDay() + 6) % 7;
  const today = format(new Date(), 'yyyy-MM-dd');

  const monthAttendedCount = calendarDays.filter(d => attendedDates.has(format(d, 'yyyy-MM-dd'))).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Attendance Calendar</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => onMonthChange(subMonths(currentMonth, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <Button variant="outline" size="sm" onClick={() => onMonthChange(addMonths(currentMonth, 1))} disabled={currentMonth >= new Date()}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {monthAttendedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {monthAttendedCount} day{monthAttendedCount !== 1 ? 's' : ''} attended this month
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
          {calendarDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const attended = attendedDates.has(dateStr);
            const isToday = dateStr === today;
            const isFuture = isBefore(startOfDay(new Date()), startOfDay(day)) && !isToday;

            return (
              <div
                key={dateStr}
                className={[
                  'min-h-[44px] rounded-lg flex flex-col items-center justify-center border transition-all',
                  isFuture
                    ? 'bg-transparent border-transparent text-muted-foreground/30'
                    : attended
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-muted/30 border-muted text-muted-foreground',
                  isToday ? 'ring-2 ring-primary ring-offset-1' : '',
                ].join(' ')}
              >
                <span className="text-sm font-bold leading-none">{format(day, 'd')}</span>
                {attended && <span className="text-[11px] font-semibold leading-none">✓</span>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-4 text-xs text-muted-foreground justify-center">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-primary/15 border border-primary/40 inline-block" /> Attended
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-muted/30 border border-muted inline-block" /> Not attended
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
