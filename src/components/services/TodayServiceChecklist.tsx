import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, Circle, XCircle, CalendarDays } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { markServiceDone } from 'zite-endpoints-sdk';
import type { GetAllocationBoardOutputType } from 'zite-endpoints-sdk';

import { SERVICE_DAYS, SERVICE_DAY_FULL } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];
const DAY_LABELS: Record<string, string> = SERVICE_DAY_FULL;

interface Props {
  data: GetAllocationBoardOutputType;
  userId: string;
  onRefresh: () => void;
}

type ChecklistItem = {
  serviceId: string;
  serviceName: string;
  timeSlot: string;
  allocationId?: string;
  status: 'completed' | 'assigned' | 'overdue';
};

export default function TodayServiceChecklist({ data, userId, onRefresh }: Props) {
  const [confirmItem, setConfirmItem] = useState<ChecklistItem | null>(null);
  const [marking, setMarking] = useState(false);

  const todayIdx = new Date().getDay();
  const todayKey = DAYS[todayIdx];
  const todayLabel = DAY_LABELS[todayKey] ?? todayKey;

  const items: ChecklistItem[] = data.services.flatMap(svc => {
    const cells = data.grid[svc.serviceId]?.[todayKey] ?? [];
    const myCell = cells.find(c => c.userId === userId);
    if (!myCell) return [];
    return [{
      serviceId: svc.serviceId,
      serviceName: svc.serviceName,
      timeSlot: svc.timeSlot,
      allocationId: myCell.allocationId,
      status: myCell.status === 'completed' ? 'completed' : myCell.isOverdue ? 'overdue' : 'assigned',
    }];
  });

  const handleMarkDone = async () => {
    if (!confirmItem?.allocationId) return;
    setMarking(true);
    try {
      await markServiceDone({ allocationId: confirmItem.allocationId });
      toast.success('Service marked as done ✅');
      setConfirmItem(null);
      onRefresh();
    } catch { toast.error('Failed to mark done'); }
    finally { setMarking(false); }
  };

  const statusIcon = (status: ChecklistItem['status']) => {
    if (status === 'completed') return <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />;
    if (status === 'overdue') return <XCircle className="w-5 h-5 text-red-500 shrink-0" />;
    return <Circle className="w-5 h-5 text-blue-500 shrink-0" />;
  };

  const statusClass = (status: ChecklistItem['status']) => {
    if (status === 'completed') return 'bg-green-50 border-green-200';
    if (status === 'overdue') return 'bg-red-50 border-red-200';
    return 'bg-blue-50 border-blue-200';
  };

  const canClick = (status: ChecklistItem['status']) => status === 'assigned' || status === 'overdue';

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            Today's Services — {todayLabel}
            <span className="text-xs font-normal text-muted-foreground ml-1">
              (tap blue/red to mark done)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-1.5">
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground py-3 text-center">No services assigned to you today</p>
          )}
          {items.map(item => (
            <button
              key={item.serviceId}
              onClick={() => canClick(item.status) && setConfirmItem(item)}
              disabled={!canClick(item.status)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-opacity ${statusClass(item.status)} ${canClick(item.status) ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
              {statusIcon(item.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium leading-snug truncate">{item.serviceName}</p>
                <p className="text-[10px] text-muted-foreground">{item.timeSlot}</p>
              </div>
              {item.status === 'completed' && <span className="text-[10px] text-green-600 font-medium shrink-0">Done ✓</span>}
              {item.status === 'overdue' && <span className="text-[10px] text-red-500 font-medium shrink-0">Overdue</span>}
              {item.status === 'assigned' && <span className="text-[10px] text-blue-600 shrink-0">Tap to mark</span>}
            </button>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmItem} onOpenChange={v => !v && setConfirmItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Service as Done?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm you have completed: <strong>{confirmItem?.serviceName}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleMarkDone} disabled={marking} className="bg-green-600 hover:bg-green-700 text-white">
              {marking ? 'Marking…' : "Yes, I've Done It ✅"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
