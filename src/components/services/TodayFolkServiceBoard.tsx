import { useEffect, useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, CheckCircle2, Clock, AlertCircle, PlusCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getTodayServiceBoard, selfAllocate, markServiceDone, updateChecklistProgress, releaseServiceAllocation, GetTodayServiceBoardOutputType } from 'zite-endpoints-sdk';
import { getCurrentServiceWeekStart } from '@/lib/serviceWeek';
import { format } from 'date-fns';

type BoardService = GetTodayServiceBoardOutputType['services'][0];
type ChecklistItem = { text: string; imageUrl?: string };

interface Props {
  residencyId?: string;
  currentUserId: string;
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, label: 'Done',    className: 'text-green-600 dark:text-green-400' },
  pending:   { icon: Clock,        label: 'Pending', className: 'text-yellow-600 dark:text-yellow-400' },
  overdue:   { icon: AlertCircle,  label: 'Overdue', className: 'text-destructive' },
  unassigned:{ icon: PlusCircle,   label: 'Open',    className: 'text-muted-foreground' },
} as const;

function SummaryBar({ summary }: { summary: GetTodayServiceBoardOutputType['summary'] }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {summary.completed > 0 && <Badge variant="outline" className="gap-1 border-green-500/40 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30">✅ {summary.completed} Done</Badge>}
      {summary.pending > 0 && <Badge variant="outline" className="gap-1 border-yellow-500/40 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30">⏳ {summary.pending} Pending</Badge>}
      {summary.overdue > 0 && <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive bg-destructive/5">🔴 {summary.overdue} Overdue</Badge>}
      {summary.unassigned > 0 && <Badge variant="outline" className="gap-1 border-border text-muted-foreground bg-muted/30">➕ {summary.unassigned} Open</Badge>}
    </div>
  );
}

// ─── Checklist Completion Dialog ────────────────────────────────────────────

function ChecklistDoneDialog({
  svc,
  open,
  onClose,
  onDone,
}: {
  svc: BoardService;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const checklist: ChecklistItem[] = useMemo(() => {
    try {
      const p = JSON.parse((svc as any).description || '[]');
      if (Array.isArray(p)) return p;
    } catch {}
    return [];
  }, [(svc as any).description]);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Load saved progress from notes
  useEffect(() => {
    if (!open) return;
    try {
      const notes = JSON.parse((svc as any).notes || '{}');
      if (Array.isArray(notes.checkedItems)) {
        setChecked(new Set(notes.checkedItems));
        return;
      }
    } catch { /* ignore */ }
    setChecked(new Set());
  }, [open, (svc as any).notes]);

  const toggle = async (idx: number) => {
    const next = new Set(checked);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setChecked(next);
    if (!svc.allocationId) return;
    setSaving(true);
    try {
      await updateChecklistProgress({ allocationId: svc.allocationId, checkedItems: Array.from(next) });
    } catch { /* progress save is best-effort */ }
    finally { setSaving(false); }
  };

  const handleComplete = async () => {
    if (!svc.allocationId) return;
    setCompleting(true);
    try {
      await markServiceDone({ allocationId: svc.allocationId });
      toast.success(`✅ "${svc.serviceName}" marked as done!`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Failed to mark done');
    } finally { setCompleting(false); }
  };

  const allChecked = checklist.length > 0 && checked.size >= checklist.length;
  const progress = checklist.length > 0 ? (checked.size / checklist.length) * 100 : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base leading-snug">{svc.serviceName}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {checked.size}/{checklist.length} completed
              {saving && <span className="ml-1 italic">· saving…</span>}
            </p>
          </DialogHeader>

          {/* Progress bar */}
          <div className="w-full bg-muted rounded-full h-1.5">
            <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>

          {/* Checklist items */}
          <div className="space-y-1 max-h-[45vh] overflow-y-auto py-1">
            {checklist.map((item, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${checked.has(idx) ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
                onClick={() => toggle(idx)}
              >
                <Checkbox checked={checked.has(idx)} onCheckedChange={() => toggle(idx)} className="mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${checked.has(idx) ? 'line-through text-muted-foreground' : ''}`}>
                    {item.text}
                  </p>
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      className="mt-1.5 h-16 w-auto max-w-full rounded border object-cover cursor-zoom-in"
                      onClick={e => { e.stopPropagation(); setLightboxUrl(item.imageUrl!); }}
                      alt=""
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {!allChecked && (
            <p className="text-xs text-center text-muted-foreground">Complete all items to enable "Mark Complete"</p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose} size="sm">Close</Button>
            <Button
              disabled={!allChecked || completing}
              onClick={handleComplete}
              size="sm"
              className="gap-1.5"
            >
              {completing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '✅'} Mark Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} className="max-w-full max-h-full object-contain rounded" alt="" />
        </div>
      )}
    </>
  );
}

// ─── Service Row ─────────────────────────────────────────────────────────────

function ServiceRow({
  svc,
  currentUserId,
  weekStart,
  onActionDone,
}: {
  svc: BoardService;
  currentUserId: string;
  weekStart: string;
  onActionDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const cfg = STATUS_CONFIG[svc.status];
  const Icon = cfg.icon;
  const isMyAllocation = svc.assigneeDbId === currentUserId;
  const canMarkDone = isMyAllocation && (svc.status === 'pending' || svc.status === 'overdue');
  const canRelease = isMyAllocation && (svc.status === 'pending' || svc.status === 'overdue');
  const canPickUp = !isMyAllocation && (svc.status === 'pending' || svc.status === 'overdue' || svc.status === 'unassigned');

  // Detect if this service uses a checklist
  const isChecklist = useMemo(() => {
    try {
      const p = JSON.parse((svc as any).description || '');
      return Array.isArray(p) && p.length > 0;
    } catch { return false; }
  }, [(svc as any).description]);

  const handleMarkDone = async () => {
    if (!svc.allocationId) return;
    // If it's a checklist service, open the checklist dialog instead
    if (isChecklist) {
      setChecklistOpen(true);
      return;
    }
    setLoading(true);
    try {
      await markServiceDone({ allocationId: svc.allocationId });
      toast.success(`✅ "${svc.serviceName}" marked as done!`);
      onActionDone();
    } catch (e: any) {
      toast.error(e.message || 'Failed to mark done');
    } finally { setLoading(false); }
  };

  const handleRelease = async () => {
    if (!svc.allocationId) return;
    setLoading(true);
    try {
      await releaseServiceAllocation({ allocationId: svc.allocationId });
      toast.success(`↩️ "${svc.serviceName}" released — it's open for others now.`);
      onActionDone();
    } catch (e: any) {
      toast.error(e.message || 'Failed to release service');
    } finally { setLoading(false); }
  };

  const handlePickUp = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][today.getDay()];
      await selfAllocate({ serviceId: svc.serviceDbId, weekStartDate: weekStart, days: [dayKey] });
      toast.success(`🙌 You picked up "${svc.serviceName}"!`);
      onActionDone();
    } catch (e: any) {
      toast.error(e.message || 'Failed to pick up service');
    } finally { setLoading(false); }
  };

  return (
    <>
      <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/40 transition-colors">
        <Icon className={`w-4 h-4 shrink-0 ${cfg.className}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium leading-tight truncate">{svc.serviceName}</p>
            {isChecklist && <span className="text-xs text-muted-foreground" title="Has checklist">☑️</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {svc.timeSlot && <span className="text-xs text-muted-foreground">{svc.timeSlot}</span>}
            {svc.assigneeFirstName ? (
              <span className={`text-xs font-medium ${isMyAllocation ? 'text-primary' : 'text-foreground/70'}`}>
                {isMyAllocation ? 'You' : svc.assigneeFirstName}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground italic">Unassigned</span>
            )}
          </div>
        </div>
        {canMarkDone && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 px-2.5 shrink-0 border-green-500/50 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
            onClick={handleMarkDone}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : (isChecklist ? '☑️ Complete' : '✅ Done')}
          </Button>
        )}
        {canRelease && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 px-2 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => setReleaseConfirmOpen(true)}
            disabled={loading}
            title="Release this service"
          >
            ↩️
          </Button>
        )}
        {canPickUp && (
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 px-2.5 shrink-0 border-primary/40 text-primary hover:bg-primary/5"
            onClick={handlePickUp}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : '🤝 Pick Up'}
          </Button>
        )}
      </div>

      {/* Checklist completion dialog */}
      {isChecklist && checklistOpen && (
        <ChecklistDoneDialog
          svc={svc}
          open={checklistOpen}
          onClose={() => setChecklistOpen(false)}
          onDone={onActionDone}
        />
      )}

      {/* Release confirmation dialog */}
      <AlertDialog open={releaseConfirmOpen} onOpenChange={setReleaseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release this service?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">"{svc.serviceName}"</span> will go back to Open so someone else can pick it up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setReleaseConfirmOpen(false); handleRelease(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              ↩️ Release
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Board ───────────────────────────────────────────────────────────────

export default function TodayFolkServiceBoard({ residencyId, currentUserId }: Props) {
  const [data, setData] = useState<GetTodayServiceBoardOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await getTodayServiceBoard({ residencyId });
      setData(res);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load service board');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [residencyId]);

  useEffect(() => { load(); }, [load]);

  const weekStart = data?.weekStartSunday || getCurrentServiceWeekStart();
  const headerDate = data
    ? `${data.dayOfWeek}, ${format(new Date(data.date + 'T00:00:00'), 'MMM d')}`
    : '…';

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            🏠 Today's FOLK Service Board
            <span className="text-muted-foreground font-normal text-xs">— {headerDate}</span>
          </CardTitle>
          <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        {data && <SummaryBar summary={data.summary} />}
      </CardHeader>

      <CardContent className="px-2 pb-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading services...</span>
          </div>
        ) : !data || data.services.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No services scheduled for today.
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {data.services.map(svc => (
              <ServiceRow
                key={svc.serviceId}
                svc={svc}
                currentUserId={currentUserId}
                weekStart={weekStart}
                onActionDone={() => load(true)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
