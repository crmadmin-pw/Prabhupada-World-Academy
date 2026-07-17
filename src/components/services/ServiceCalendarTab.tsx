import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar, Clock } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { toast } from 'sonner';
import { getServiceCalendar } from 'zite-endpoints-sdk';
import type { GetServiceCalendarOutputType } from 'zite-endpoints-sdk';

type ServiceEntry = GetServiceCalendarOutputType['entries'][0]['services'][0];

const STATUS_COLOR: Record<string, string> = {
  completed: 'bg-green-500',
  overdue:   'bg-red-500',
  swapped:   'bg-orange-400',
  assigned:  'bg-blue-400',
};

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  overdue:   'bg-red-100 text-red-800',
  swapped:   'bg-orange-100 text-orange-800',
  assigned:  'bg-blue-100 text-blue-800',
};

function getDayDot(services: ServiceEntry[]): string {
  if (!services.length) return '';
  if (services.some(s => s.status === 'overdue')) return 'bg-red-500';
  if (services.every(s => s.status === 'completed')) return 'bg-green-500';
  return 'bg-blue-400';
}

export default function ServiceCalendarTab() {
  const [month, setMonth] = useState(new Date());
  const [entries, setEntries] = useState<GetServiceCalendarOutputType['entries']>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => { load(); }, [month]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getServiceCalendar({ year: month.getFullYear(), month: month.getMonth() + 1 });
      setEntries(res.entries);
    } catch { toast.error('Failed to load calendar'); }
    finally { setLoading(false); }
  };

  const entryMap = new Map(entries.map(e => [e.date, e.services]));
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });
  const firstDow = (days[0].getDay() + 6) % 7;
  const today = format(new Date(), 'yyyy-MM-dd');
  const canGoNext = month < new Date();

  const selectedServices: ServiceEntry[] = selectedDate ? ((entryMap.get(selectedDate) ?? []) as ServiceEntry[]) : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4" />Service Calendar</CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMonth(subMonths(month, 1))}>
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <span className="text-xs font-medium min-w-[90px] text-center">{format(month, 'MMM yyyy')}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMonth(addMonths(month, 1))} disabled={!canGoNext}>
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['M','T','W','T','F','S','S'].map((d, i) => (
                  <div key={i} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
                {days.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const daySvcs: ServiceEntry[] = (entryMap.get(dateStr) ?? []) as ServiceEntry[];
                  const isFuture = dateStr > today;
                  const isToday = dateStr === today;
                  const isSelected = selectedDate === dateStr;
                  const dotColor = getDayDot(daySvcs);
                  return (
                    <button key={dateStr}
                      onClick={() => !isFuture && setSelectedDate(isSelected ? null : dateStr)}
                      disabled={isFuture}
                      className={`aspect-square rounded-lg text-[11px] font-medium flex flex-col items-center justify-center gap-0.5 transition-colors min-h-[36px] sm:min-h-0
                        ${isSelected ? 'bg-primary text-primary-foreground' : daySvcs.length > 0 ? 'bg-primary/10 text-foreground hover:bg-primary/20 active:bg-primary/30' : 'text-muted-foreground/50'}
                        ${isToday ? 'ring-2 ring-primary ring-offset-1' : ''}
                        ${isFuture ? 'opacity-30 cursor-not-allowed' : daySvcs.length > 0 ? 'cursor-pointer' : 'cursor-default'}
                      `}
                    >
                      <span>{format(day, 'd')}</span>
                      {dotColor && !isSelected && <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-3 text-[10px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />All done</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 inline-block" />Pending</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />Overdue</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Selected day detail */}
      {selectedDate && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Services on {format(new Date(selectedDate), 'EEEE, dd MMM yyyy')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {selectedServices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No services on this day.</p>
            ) : (
              <div className="space-y-2">
                {selectedServices.map(s => (
                  <div key={s.allocationId} className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{s.serviceName}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />{s.timeSlot}
                      </p>
                    </div>
                    <Badge className={`text-[10px] shrink-0 ${STATUS_BADGE[s.status] ?? STATUS_BADGE.assigned}`}>
                      {s.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
