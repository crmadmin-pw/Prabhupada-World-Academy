import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, CheckCircle2, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { markServiceDone } from 'zite-endpoints-sdk';
import type { GetWeeklyScheduleOutputType } from 'zite-endpoints-sdk';
import ServiceStatusBadge from './ServiceStatusBadge';
import SwapRequestModal from './SwapRequestModal';

type ScheduleItem = GetWeeklyScheduleOutputType['schedule'][0];

interface Props {
  items: ScheduleItem[];
  onDone: (allocationId: string) => void;
  onSwapRequested: (allocationId: string) => void;
}

const CARD_BG: Record<string, string> = {
  completed: 'border-green-200 bg-green-50',
  overdue:   'border-red-300 bg-red-50',
  swapped:   'border-orange-200 bg-orange-50',
  assigned:  'border-border bg-card',
};

export default function TodayServicesCard({ items, onDone, onSwapRequested }: Props) {
  const [marking, setMarking] = useState<string | null>(null);
  const [swapTarget, setSwapTarget] = useState<ScheduleItem | null>(null);

  const handleDone = async (allocationId: string) => {
    setMarking(allocationId);
    try {
      await markServiceDone({ allocationId });
      toast.success('Service marked as done ✅');
      onDone(allocationId);
    } catch { toast.error('Failed to mark done'); }
    finally { setMarking(null); }
  };

  if (items.length === 0) return (
    <Card className="border-dashed">
      <CardContent className="py-6 text-center text-sm text-muted-foreground">No services assigned for today 🙏</CardContent>
    </Card>
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {items.some(i => i.isOverdue) ? <AlertTriangle className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-primary" />}
            Today's Services ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-0">
          {items.map(item => (
            <div key={item.allocationId} className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${CARD_BG[item.isOverdue ? 'overdue' : item.status] ?? CARD_BG.assigned}`}>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{item.serviceName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{item.timeSlot}</span>
                  {item.durationMinutes && <span className="text-xs text-muted-foreground">~{item.durationMinutes}m</span>}
                  <ServiceStatusBadge status={item.status} isOverdue={item.isOverdue} />
                </div>
              </div>
              {item.status !== 'completed' && item.status !== 'swapped' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2"
                    onClick={() => setSwapTarget(item)}
                    title="Request swap"
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                  </Button>
                  <Button size="sm" className="h-8" disabled={marking === item.allocationId} onClick={() => handleDone(item.allocationId)}>
                    {marking === item.allocationId ? '…' : 'Done ✓'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {swapTarget && (
        <SwapRequestModal
          open={!!swapTarget}
          onClose={() => setSwapTarget(null)}
          allocationId={swapTarget.allocationId}
          serviceName={swapTarget.serviceName}
          onRequested={(id) => { onSwapRequested(id); setSwapTarget(null); }}
        />
      )}
    </>
  );
}
