import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { CalendarDays, AlertCircle } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';
import { requestUnavailability } from 'zite-endpoints-sdk';
import type { GetWeeklyScheduleOutputType } from 'zite-endpoints-sdk';
import ServiceStatusBadge from './ServiceStatusBadge';

type ScheduleItem = GetWeeklyScheduleOutputType['schedule'][0];

import { SERVICE_DAY_LABELS, SERVICE_DAYS } from '@/lib/serviceWeek';
const DAY_LABELS = SERVICE_DAY_LABELS;
const DAYS = [...SERVICE_DAYS];

interface Props {
  weekStartDate: string;
  schedule: ScheduleItem[];
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

interface UnavailReqState {
  date: string;
  allocationId?: string;
  serviceName?: string;
}

export default function WeekScheduleView({ weekStartDate, schedule, onPrevWeek, onNextWeek }: Props) {
  const [unavailTarget, setUnavailTarget] = useState<UnavailReqState | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const weekEnd = format(addDays(new Date(weekStartDate), 6), 'dd MMM');
  const weekStartFmt = format(new Date(weekStartDate), 'dd MMM');

  const byDay = DAYS.reduce((acc, d) => {
    acc[d] = schedule.filter(s => {
      const dow = (s.dayOfWeek || '').toLowerCase().slice(0, 3);
      return dow === d;
    });
    return acc;
  }, {} as Record<string, ScheduleItem[]>);

  const handleRequestUnavailability = (date: string, allocationId?: string, serviceName?: string) => {
    setUnavailTarget({ date, allocationId, serviceName });
    setReason('');
  };

  const handleSubmitUnavailability = async () => {
    if (!unavailTarget) return;
    setSubmitting(true);
    try {
      await requestUnavailability({
        date: unavailTarget.date,
        reason,
        allocationId: unavailTarget.allocationId,
      });
      toast.success('Leave request submitted — awaiting guide approval');
      setUnavailTarget(null);
    } catch { toast.error('Failed to submit request'); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" />This Week's Schedule</span>
            <div className="flex items-center gap-2 text-xs font-normal">
              <button onClick={onPrevWeek} className="px-2 py-1 rounded hover:bg-muted">←</button>
              <span className="text-muted-foreground">{weekStartFmt} – {weekEnd}</span>
              <button onClick={onNextWeek} className="px-2 py-1 rounded hover:bg-muted">→</button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {DAYS.map((d, i) => {
            const items = byDay[d] ?? [];
            const date = format(addDays(new Date(weekStartDate), i), 'yyyy-MM-dd');
            const dateLabel = format(addDays(new Date(weekStartDate), i), 'dd');
            return (
              <div key={d} className="flex gap-3 items-start">
                <div className="w-12 shrink-0 text-center">
                  <div className="text-xs font-medium text-muted-foreground">{DAY_LABELS[i]}</div>
                  <div className="text-sm font-bold">{dateLabel}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {items.length === 0 ? (
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-muted-foreground py-1">—</p>
                      <button
                        onClick={() => handleRequestUnavailability(date)}
                        className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-0.5 py-1"
                        title="Request unavailability for this day"
                      >
                        <AlertCircle className="w-2.5 h-2.5" />Leave
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {items.map(item => (
                        <div key={item.allocationId} className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${item.isOverdue ? 'bg-red-50' : item.status === 'completed' ? 'bg-green-50' : 'bg-muted/40'}`}>
                          <span className="font-medium truncate">{item.serviceName}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-muted-foreground">{item.timeSlot}</span>
                            <ServiceStatusBadge status={item.status} isOverdue={item.isOverdue} />
                            {item.status !== 'completed' && (
                              <button
                                onClick={() => handleRequestUnavailability(date, item.allocationId, item.serviceName)}
                                className="text-[10px] text-muted-foreground/50 hover:text-amber-600 flex items-center gap-0.5"
                                title="Request leave for this service"
                              >
                                <AlertCircle className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Unavailability request dialog */}
      <Dialog open={!!unavailTarget} onOpenChange={v => !v && setUnavailTarget(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Request Leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="text-xs text-muted-foreground">
              <p>Date: <strong>{unavailTarget?.date ? format(new Date(unavailTarget.date), 'd MMM yyyy') : ''}</strong></p>
              {unavailTarget?.serviceName && <p>Service: <strong>{unavailTarget.serviceName}</strong></p>}
            </div>
            <Textarea
              placeholder="Reason for leave request (optional)…"
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="text-sm resize-none h-20"
            />
            <p className="text-[10px] text-muted-foreground">Your guide will review and approve or reject this request.</p>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setUnavailTarget(null)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmitUnavailability} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
