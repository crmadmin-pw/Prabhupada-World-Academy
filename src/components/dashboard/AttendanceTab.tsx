import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Flame, Calendar, ClipboardCheck, ChevronLeft, ChevronRight, CalendarDays, BookOpenCheck } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isBefore, startOfDay } from 'date-fns';
import { getMyBvQuizSubmissions, getUserAttendanceCalendar } from '@/lib/endpoints-sdk';
import { fmt } from '@/lib/fmt';

interface Props { userId: string; segment: 'PW' | 'FOLK'; }

export default function AttendanceTab({ userId, segment }: Props) {
  const [data, setData] = useState<any>(null);
  const [quizDates, setQuizDates] = useState<{ date: string; percentage: number; quizTitle?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const fetchAttendance = useReactiveLoader(async (read) => {
    try {
      const attendance = await read(() => getUserAttendanceCalendar({}));
      !read.cancelled && setData(attendance);
      if (segment === 'FOLK') {
        const quizzes = await read(() => getMyBvQuizSubmissions({}));
        !read.cancelled && setQuizDates((quizzes.quizDates || []) as { date: string; percentage: number; quizTitle?: string }[]);
      } else {
        !read.cancelled && setQuizDates([]);
      }
    } catch {
      if (read.cancelled) return;
      // Keep the attendance tab usable if optional FOLK quiz history fails.
    } finally {
      !read.cancelled && setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttendance();
    window.addEventListener('attendanceUpdated', fetchAttendance);
    return () => window.removeEventListener('attendanceUpdated', fetchAttendance);
  }, [userId, segment]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const stats = data?.stats || {};
  const entries: any[] = data?.entries || [];

  // Map each date to present status: true (P), false (A)
  const attendanceMap = new Map<string, boolean | 'L'>();
  entries.forEach((e: any) => {
    if (e.date) {
      attendanceMap.set(e.date, e.status === 'L' ? 'L' : (e.present ?? (e.status === 'P')));
    }
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <CalendarDays className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.totalDaysAttended || 0}</p>
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
        attendanceMap={attendanceMap}
        quizDates={quizDates}
        currentMonth={currentMonth}
        onMonthChange={setCurrentMonth}
      />

      {/* Recent entries */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-primary" /> Recent Attendance History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No attendance records yet</p>
          ) : (
            <div className="divide-y max-h-[400px] overflow-y-auto">
              {entries.slice(0, 20).map((e: any, i: number) => {
                const isPresent = e.present ?? (e.status === 'P');
                const isLeave = e.status === 'L';
                return (
                  <div key={i} className="py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{e.sessionName || 'Session'}</p>
                      <p className="text-xs text-muted-foreground">{e.eventTitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={isLeave ? 'bg-amber-50 text-amber-700 border-amber-300' : isPresent ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-300'}>
                        {isLeave ? 'L Leave' : isPresent ? '✓ Attended' : '✗ Not Attended'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">{fmt.date(e.date)}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceCalendar({ attendanceMap, quizDates, currentMonth, onMonthChange }: {
  attendanceMap: Map<string, boolean | 'L'>;
  quizDates: { date: string; percentage: number; quizTitle?: string }[];
  currentMonth: Date;
  onMonthChange: (d: Date) => void;
}) {
  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  const firstDayOfWeek = (calendarDays[0].getDay() + 6) % 7;
  const today = format(new Date(), 'yyyy-MM-dd');

  const monthAttendedCount = calendarDays.filter(d => attendanceMap.get(format(d, 'yyyy-MM-dd')) === true).length;
  const quizMap = new Map(quizDates.filter(quiz => quiz.date).map(quiz => [quiz.date, quiz]));

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
            const hasRecord = attendanceMap.has(dateStr);
            const isPresent = attendanceMap.get(dateStr) === true;
            const isLeave = attendanceMap.get(dateStr) === 'L';
            const isAbsent = hasRecord && !isPresent && !isLeave;
            const quiz = quizMap.get(dateStr);
            const isToday = dateStr === today;
            const isFuture = isBefore(startOfDay(new Date()), startOfDay(day)) && !isToday;

            const title = [
              isPresent ? `${dateStr}: Attended` : isLeave ? `${dateStr}: Leave` : isAbsent ? `${dateStr}: Not attended` : `${dateStr}: Not marked`,
              quiz ? `Quiz completed: ${quiz.percentage}%${quiz.quizTitle ? ` — ${quiz.quizTitle}` : ''}` : '',
            ].filter(Boolean).join('\n');

            return (
              <div
                key={dateStr}
                title={title}
                className={[
                  'min-h-[54px] rounded-lg flex flex-col items-center justify-center border transition-all font-semibold p-1',
                  isFuture
                    ? 'bg-transparent border-transparent text-muted-foreground/30'
                    : isPresent
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-bold'
                    : isLeave
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 font-bold'
                    : isAbsent
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400 font-bold'
                    : 'bg-muted/30 border-muted text-muted-foreground',
                  isToday ? 'ring-2 ring-primary ring-offset-1' : '',
                ].join(' ')}
              >
                <span className="text-sm leading-none">{format(day, 'd')}</span>
                <div className="flex items-center gap-0.5 mt-0.5 min-h-[12px]">
                  {isPresent && <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 leading-none">✓</span>}
                  {isLeave && <span className="text-[11px] font-bold text-amber-700 leading-none">L</span>}
                  {isAbsent && <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 leading-none">✗</span>}
                </div>
                {quiz && (
                  <div className="mt-1 flex items-center justify-center gap-0.5 px-1 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300 text-[8px] font-extrabold leading-none select-none">
                    <BookOpenCheck className="w-2.5 h-2.5 text-violet-600 dark:text-violet-400 shrink-0" />
                    <span>{quiz.percentage}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-6 mt-4 text-xs font-medium justify-center">
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Attended (✓)
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300">
            <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Not Attended (✗)
          </span>
          {quizDates.length > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/15 border border-violet-500/40 text-violet-700 dark:text-violet-300">
              <BookOpenCheck className="w-3.5 h-3.5" /> Quiz completed (Q)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
