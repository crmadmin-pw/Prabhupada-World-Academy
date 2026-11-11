import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isBefore, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import { markBvAttendance } from '@/lib/endpoints-sdk';
import type { GetBvAttendanceOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

type HistoryItem = GetBvAttendanceOutputType['userHistory'][0];

interface Props {
  history: HistoryItem[];
  userId?: string;
  onRefresh?: () => void;
  quizDates?: { date: string; percentage: number }[];
}

export default function BvCalendarView({ history, userId, onRefresh, quizDates }: Props) {
  const { profile } = useUserProfile();
  const activeUserId = userId || (profile as any)?.id || profile?.userId;
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [marking, setMarking] = useState<'P' | 'A' | 'L' | null>(null);
  const [overrideMap, setOverrideMap] = useState<Record<string, string>>({});

  const statusMap = new Map<string, string>();
  history.forEach(h => { if (h.attendanceDate) statusMap.set(h.attendanceDate, h.status); });
  // Apply optimistic overrides
  Object.entries(overrideMap).forEach(([d, st]) => statusMap.set(d, st));

  const quizDateMap = new Map<string, number>();
  (quizDates || []).forEach(q => { if (q.date) quizDateMap.set(q.date, q.percentage); });

  const calendarDays = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });
  // BUG-4 FIX: Monday-first week — (getDay()+6)%7 maps Sun=6, Mon=0, Tue=1...
  const firstDayOfWeek = (calendarDays[0].getDay() + 6) % 7;
  const today = format(new Date(), 'yyyy-MM-dd');

  const canMarkAttendance = !!(
    profile?.isBvFacilitator ||
    profile?.isBvsl ||
    profile?.isBvSubFacilitator ||
    profile?.isBvMentor ||
    profile?.isBvSupervisor ||
    (profile?.role as string) === 'SUPER_ADMIN' ||
    (profile?.role as string) === 'ADMIN' ||
    profile?.role === 'SUPER_GUIDE' ||
    profile?.role === 'GUIDE' ||
    (profile as any)?.isBvAdmin ||
    (profile as any)?.isBvSuperAdmin
  );

  const presentCount = Array.from(statusMap.values()).filter(st => st === 'P').length;
  const totalCount = Array.from(statusMap.values()).filter(st => st !== 'L').length;

  const handleDayClick = (dateStr: string, isFuture: boolean) => {
    if (isFuture || !activeUserId || !canMarkAttendance) return;
    setSelectedDate(prev => prev === dateStr ? null : dateStr);
  };

  const handleMark = async (status: 'P' | 'A' | 'L') => {
    if (!selectedDate || !activeUserId || !canMarkAttendance) return;
    const targetDate = selectedDate;
    setMarking(status);
    // Optimistically update calendar UI immediately
    setOverrideMap(prev => ({ ...prev, [targetDate]: status }));
    try {
      await markBvAttendance({ userId: activeUserId, status, localDate: targetDate } as any);
      toast.success(`Marked ${status === 'P' ? 'Present' : status === 'L' ? 'Leave' : 'Absent'} for ${targetDate}`);
      setSelectedDate(null);
      window.dispatchEvent(new Event('attendanceUpdated'));
      if (onRefresh) {
        onRefresh();
      }
    } catch {
      setOverrideMap(prev => { const next = { ...prev }; delete next[targetDate]; return next; });
      toast.error('Failed to mark attendance');
    } finally {
      setMarking(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            <CardTitle className="text-base">Attendance Calendar</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(subMonths(currentMonth, 1)); setSelectedDate(null); }}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-medium min-w-[120px] text-center">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <Button
              variant="outline" size="sm"
              onClick={() => { setCurrentMonth(addMonths(currentMonth, 1)); setSelectedDate(null); }}
              disabled={currentMonth >= new Date()}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        {totalCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {presentCount}/{totalCount} days present · <span className="font-medium text-primary">{Math.round((presentCount / totalCount) * 100)}% Attendance</span>
            {activeUserId && canMarkAttendance && (
              <span className="ml-2 text-muted-foreground/70">· Tap a day to edit</span>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* Inline edit bar for facilitators */}
        {selectedDate && activeUserId && canMarkAttendance && (
          <div className="mb-3 p-3 rounded-lg bg-muted/50 border flex items-center justify-between gap-2 flex-wrap">
            <span className="text-sm font-medium">Mark {selectedDate}:</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={marking !== null}
                className="text-xs border-green-500 text-green-600 hover:bg-green-50"
                onClick={() => handleMark('P')}>
                {marking === 'P' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Present
              </Button>
              <Button size="sm" variant="outline" disabled={marking !== null}
                className="text-xs border-red-400 text-red-500 hover:bg-red-50"
                onClick={() => handleMark('A')}>
                {marking === 'A' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}Absent
              </Button>
              <Button size="sm" variant="outline" disabled={marking !== null}
                className="text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
                onClick={() => handleMark('L')}>
                {marking === 'L' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : 'L'} Leave
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedDate(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-7 gap-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
          ))}
          {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
          {calendarDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const status = statusMap.get(dateStr);
            const isToday = dateStr === today;
            const isFuture = isBefore(startOfDay(new Date()), startOfDay(day)) && !isToday;
            const isSelected = selectedDate === dateStr;
            const isPast = !isFuture && !isToday;

            const showClickToMark = canMarkAttendance && !status;
            const tooltipTitle = status
              ? `${dateStr}: ${status === 'P' ? 'Present' : status === 'L' ? 'Leave' : 'Absent'}`
              : isFuture
              ? ''
              : `${dateStr}: Not marked${showClickToMark ? ' — click to mark' : ''}`;

            return (
              <div
                key={dateStr}
                title={tooltipTitle}
                onClick={() => handleDayClick(dateStr, isFuture)}
                className={[
                  'min-h-[44px] rounded-lg flex flex-col items-center justify-center border gap-0.5 transition-all',
                  isFuture
                    ? 'bg-transparent border-transparent text-muted-foreground/30'
                    : status === 'P'
                    ? 'bg-green-100 border-green-400 text-green-700'
                    : status === 'A'
                    ? 'bg-red-50 border-red-300 text-red-500'
                    : status === 'L'
                    ? 'bg-amber-50 border-amber-400 text-amber-700'
                    : isPast || isToday
                    ? `bg-muted/40 border-muted text-muted-foreground ${canMarkAttendance ? 'cursor-pointer hover:bg-muted/70' : ''}`
                    : 'bg-muted/30 border-muted text-muted-foreground',
                  isToday ? 'ring-2 ring-primary ring-offset-1' : '',
                  isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : '',
                  activeUserId && !isFuture && canMarkAttendance ? 'cursor-pointer' : '',
                ].join(' ')}
              >
                <span className="text-sm font-bold leading-none">{format(day, 'd')}</span>
                {status && (
                  <span className="text-[11px] font-semibold leading-none">
                    {status === 'P' ? '✓' : status === 'L' ? 'L' : '✗'}
                  </span>
                )}
                {quizDateMap.has(dateStr) && (
                  <span className="text-[9px] leading-none">✍</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 text-xs text-muted-foreground justify-center flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-green-100 border border-green-400 inline-block" />Present
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-red-50 border border-red-300 inline-block" />Absent
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-amber-50 border border-amber-400 inline-block" />Leave
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-4 rounded bg-muted/40 border border-muted inline-block" />Not marked
          </span>
          {(quizDates || []).length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-sm">✍</span>Quiz submitted
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
