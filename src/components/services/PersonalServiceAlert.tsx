import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { getTodayServiceBoard, markServiceDone } from 'zite-endpoints-sdk';
import type { GetTodayServiceBoardOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

type BoardService = GetTodayServiceBoardOutputType['services'][0];

interface Props {
  residencyId?: string;
}

export default function PersonalServiceAlert({ residencyId }: Props) {
  const { user } = useAuth();
  const [services, setServices] = useState<BoardService[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getTodayServiceBoard({ residencyId });
      // Filter to only the current user's services using the DB record ID
      const mine = (res.services || []).filter(
        s => s.assigneeDbId === user?.id
      );
      setServices(mine);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [residencyId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const handleDone = async (svc: BoardService) => {
    if (!svc.allocationId) return;
    setMarking(svc.allocationId);
    try {
      await markServiceDone({ allocationId: svc.allocationId });
      toast.success(`✅ "${svc.serviceName}" marked as done!`);
      setServices(prev =>
        prev.map(s => s.allocationId === svc.allocationId ? { ...s, status: 'completed' } : s)
      );
    } catch { toast.error('Failed to mark done'); }
    finally { setMarking(null); }
  };

  if (loading || services.length === 0) return null;

  const pending = services.filter(s => s.status === 'pending');
  const overdue = services.filter(s => s.status === 'overdue');
  const done = services.filter(s => s.status === 'completed');
  const allDone = pending.length === 0 && overdue.length === 0;

  if (allDone) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-700">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="font-medium">All services done for today 🙏</span>
      </div>
    );
  }

  const hasOverdue = overdue.length > 0;
  const urgentServices = [...overdue, ...pending];

  return (
    <div className={`rounded-lg border ${hasOverdue ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
      {/* Header row */}
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={() => setCollapsed(c => !c)}
      >
        {hasOverdue
          ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
          : <Clock className="w-4 h-4 text-amber-600 shrink-0" />
        }
        <span className={`text-sm font-semibold flex-1 ${hasOverdue ? 'text-destructive' : 'text-amber-700'}`}>
          {hasOverdue
            ? `${overdue.length} overdue service${overdue.length > 1 ? 's' : ''}${pending.length > 0 ? ` · ${pending.length} pending` : ''}`
            : `${pending.length} service${pending.length > 1 ? 's' : ''} pending today`
          }
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {done.length > 0 && (
            <span className="text-[11px] text-green-700 font-medium">{done.length} done ✓</span>
          )}
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </div>
      </button>

      {/* Expanded service list */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-border/40 pt-2">
          {urgentServices.map(svc => (
            <div key={svc.serviceId} className="flex items-center gap-2.5">
              {/* Status dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${svc.status === 'overdue' ? 'bg-destructive' : 'bg-amber-500'}`} />

              {/* Service info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{svc.serviceName}</p>
                {svc.timeSlot && (
                  <p className="text-[11px] text-muted-foreground">{svc.timeSlot}</p>
                )}
              </div>

              {/* Done button */}
              <Button
                size="sm"
                variant={svc.status === 'overdue' ? 'destructive' : 'outline'}
                className={`h-7 text-xs px-2.5 shrink-0 ${svc.status === 'overdue'
                  ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
                  : 'border-green-500/40 text-green-700 hover:bg-green-50'
                }`}
                onClick={() => handleDone(svc)}
                disabled={marking === svc.allocationId}
              >
                {marking === svc.allocationId
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : '✅ Done'
                }
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
