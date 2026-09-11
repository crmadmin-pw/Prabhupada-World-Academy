import { useState, memo, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';

interface HistoryEntry {
  entryDate: string;
  scorePercent: number | null;
  totalScore: number;
  submittedAt?: string;
  flagSick?: boolean;
  flagOs?: boolean;
}

interface Props {
  entries: HistoryEntry[];
  onDayClick: (date: string) => void;
  isResident?: boolean;
  mode?: 'sadhana' | 'attendance';
}

function getDayColor(entry: HistoryEntry | undefined, isResident = false): string {
  if (!entry) return 'bg-muted/40 text-muted-foreground/50';
  // OS/Sick — shown as purple/indigo (excused)
  if (entry.flagOs || entry.flagSick) return 'bg-indigo-400 text-white';
  const p = entry.scorePercent == null ? null : Number(entry.scorePercent);
  if (p == null) return 'bg-primary/70 text-primary-foreground';
  const greenThreshold = isResident ? 95 : 75;
  const yellowThreshold = isResident ? 85 : 50;
  if (p >= greenThreshold) return 'bg-green-500 text-white';
  if (p >= yellowThreshold) return 'bg-yellow-400 text-yellow-900';
  return 'bg-red-400 text-white';
}

function getDayEmoji(entry: HistoryEntry | undefined): string {
  if (!entry) return '';
  if (entry.flagOs && entry.flagSick) return '🤒';
  if (entry.flagOs) return '✈';
  if (entry.flagSick) return '🤒';
  return '';
}

function MiniCalendar({ entries, onDayClick, isResident = false, mode = 'sadhana' }: Props) {
  const [month, setMonth] = useState(new Date());
  const today = format(new Date(), 'yyyy-MM-dd');

  // Normalize entryDate to date-only (strip time component if ISO string)
  const entryMap = useMemo(() => {
    const map = new Map<string, HistoryEntry>();
    for (const entry of entries) {
      const date = String(entry.entryDate || '').slice(0, 10);
      if (!date) continue;
      const existing = map.get(date);
      // If a legacy/migrated user has more than one entry on a day, render the
      // latest submitted record deterministically instead of letting array
      // order randomly decide the calendar color.
      if (!existing || String(entry.submittedAt || '') >= String(existing.submittedAt || '')) map.set(date, entry);
    }
    return map;
  }, [entries]);
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const firstDow = (days[0].getDay() + 6) % 7;
  const canGoNext = startOfMonth(month) < startOfMonth(new Date());

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="w-4 h-4" />Monthly View
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Previous month" onClick={() => setMonth(subMonths(month, 1))}>
              <ChevronLeft className="w-3 h-3" />
            </Button>
            <span className="text-xs font-medium min-w-[90px] text-center">{format(month, 'MMM yyyy')}</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} disabled={!canGoNext}>
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['M','T','W','T','F','S','S'].map((d, i) => (
            <div key={i} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const entry = entryMap.get(dateStr);
            const isFuture = dateStr > today;
            const isToday = dateStr === today;
            const attendanceStatus = !entry || isFuture ? 'Not marked' : entry.scorePercent === 100 ? 'Present' : 'Absent';
            const emoji = getDayEmoji(isFuture ? undefined : entry);
            return (
              <button
                key={dateStr}
                aria-label={mode === 'attendance' ? `${dateStr}: ${attendanceStatus}` : dateStr}
                disabled={isFuture}
                onClick={() => onDayClick(dateStr)}
                className={`
                  aspect-square rounded text-[10px] font-medium flex flex-col items-center justify-center
                  transition-opacity leading-tight
                  ${mode === 'attendance'
                    ? attendanceStatus === 'Present' ? 'bg-green-500 text-white'
                      : attendanceStatus === 'Absent' ? 'bg-red-400 text-white'
                      : 'bg-muted/40 text-muted-foreground/50'
                    : getDayColor(isFuture ? undefined : entry, isResident)}
                  ${isToday ? 'ring-2 ring-primary ring-offset-1' : ''}
                  ${!isFuture ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                `}
                title={
                  mode === 'attendance' ? attendanceStatus : entry
                    ? [
                        entry.flagOs && entry.flagSick ? 'Sick & OS' : entry.flagOs ? 'Out of Station' : entry.flagSick ? 'Sick' : null,
                        entry.scorePercent != null ? `Score: ${entry.scorePercent}%` : entry.totalScore != null ? `Score: ${entry.totalScore} pts` : null,
                      ].filter(Boolean).join(' · ') || undefined
                    : undefined
                }
              >
                {emoji ? (
                  <>
                    <span className="text-[8px] leading-none">{format(day, 'd')}</span>
                    <span className="text-[8px] leading-none">{emoji}</span>
                  </>
                ) : (
                  format(day, 'd')
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-[10px] text-muted-foreground">
          {mode === 'attendance' ? <>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" />Present</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block" />Absent</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-muted/40 inline-block" />Not marked</span>
          </> : <>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" />{isResident ? '≥95%' : '≥75%'}</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 inline-block" />{isResident ? '85–94%' : '50–74%'}</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block" />{isResident ? '<85%' : '<50%'}</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-400 inline-block" />OS/Sick</span>
          </>}
        </div>
      </CardContent>
    </Card>
  );
}

export default memo(MiniCalendar);
