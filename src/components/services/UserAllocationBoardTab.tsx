import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { format, addDays } from 'date-fns';
import { Calendar, CheckCircle2, Users, PlusCircle, ChevronLeft, ChevronRight, Clock, ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { getAllocationBoard, markServiceDone, selfAllocate } from 'zite-endpoints-sdk';
import type { GetAllocationBoardOutputType } from 'zite-endpoints-sdk';
import SwapRequestModal from './SwapRequestModal';
import TodayServiceChecklist from './TodayServiceChecklist';

function weekLabel(ws: string): string {
  const thisWeek = getCurrentServiceWeekStart();
  const nextWeek = format(addDays(new Date(thisWeek), 7), 'yyyy-MM-dd');
  const lastWeek = format(addDays(new Date(thisWeek), -7), 'yyyy-MM-dd');
  if (ws === thisWeek) return 'This Week';
  if (ws === nextWeek) return 'Next Week';
  if (ws === lastWeek) return 'Last Week';
  return format(new Date(ws + 'T00:00:00'), "'Wk of' d MMM");
}

function weekRange(ws: string): string {
  const start = new Date(ws + 'T00:00:00');
  const end = addDays(start, 6);
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
}

import { SERVICE_DAY_LABELS as DAY_LABELS, SERVICE_DAYS, getCurrentServiceWeekStart } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];

const STATUS_CELL: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  overdue:   'bg-red-100 text-red-800 border-red-200',
  swapped:   'bg-orange-100 text-orange-800 border-orange-200',
  assigned:  'bg-primary/10 text-primary border-primary/20',
};

const STATUS_BADGE_MOBILE: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  overdue:   'bg-red-100 text-red-700 border-red-200',
  swapped:   'bg-orange-100 text-orange-800 border-orange-200',
  assigned:  'bg-primary/10 text-primary border-primary/20',
};

type GridCell = GetAllocationBoardOutputType['grid'][string][string][0];
interface ActionTarget { cell: GridCell; serviceName: string; }
interface SelfAllocTarget { serviceId: string; serviceName: string; timeSlot: string; day: string; }
interface Props { userId: string; residencyId?: string; }

// Mobile day-by-day card view
function MobileDayView({
  data, userId, weekStart,
  onAction, onSelfAlloc,
}: {
  data: GetAllocationBoardOutputType;
  userId: string;
  weekStart: string;
  onAction: (t: ActionTarget) => void;
  onSelfAlloc: (t: SelfAllocTarget) => void;
}) {
  const todayKey = DAYS[new Date().getDay()]; // SERVICE_DAYS is Sun-indexed: 0=sun,1=mon…

  return (
    <div className="space-y-3">
      {DAYS.map((day, i) => {
        const dateStr = format(addDays(new Date(weekStart + 'T00:00:00'), i), 'EEE d MMM');
        const isToday = day === todayKey;

        // Collect all services for this day
        const dayServices = data.services.flatMap(svc => {
          const cells = data.grid[svc.serviceId]?.[day] ?? [];
          const myCell = cells.find(c => c.userId === userId);
          const isEmpty = !cells.some(c => c.userId === userId);
          return [{
            svc,
            myCell: myCell || null,
            isEmpty,
            cells,
          }];
        }).filter(({ myCell, isEmpty }) => myCell || isEmpty);

        const myServices = dayServices.filter(d => d.myCell);
        const emptyServices = dayServices.filter(d => d.isEmpty);

        if (myServices.length === 0 && emptyServices.length === 0) return null;
        if (myServices.length === 0) return null; // only show days with my assignments

        return (
          <div key={day}>
            <div className={`flex items-center gap-2 mb-2`}>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${isToday ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                {dateStr}
              </div>
              {isToday && <span className="text-[10px] text-primary font-medium">TODAY</span>}
            </div>
            <div className="space-y-1.5 pl-1">
              {myServices.map(({ svc, myCell }) => {
                if (!myCell) return null;
                const status = myCell.status as string;
                const canAct = status !== 'completed' && status !== 'swapped';
                return (
                  <button
                    key={svc.serviceId}
                    disabled={!canAct}
                    onClick={() => canAct && onAction({ cell: myCell, serviceName: svc.serviceName })}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all ${STATUS_BADGE_MOBILE[status] ?? STATUS_BADGE_MOBILE.assigned} ${canAct ? 'active:scale-[0.98]' : 'opacity-80'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug truncate">{svc.serviceName}</p>
                      <p className="text-[11px] opacity-70 flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" />{svc.timeSlot}
                      </p>
                    </div>
                    {status === 'completed' && <span className="text-[10px] font-semibold shrink-0">Done ✓</span>}
                    {status === 'overdue' && <span className="text-[10px] font-semibold shrink-0">Overdue ⚠</span>}
                    {status === 'swapped' && <span className="text-[10px] font-semibold shrink-0">Swapped</span>}
                    {canAct && (
                      <div className="flex gap-1 shrink-0">
                        <span className="text-[10px] opacity-60">Tap</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {data.services.every(svc =>
        DAYS.every(day => !data.grid[svc.serviceId]?.[day]?.some(c => c.userId === userId))
      ) && (
        <p className="text-center py-8 text-sm text-muted-foreground">No services assigned to you this week.</p>
      )}
    </div>
  );
}

export default function UserAllocationBoardTab({ userId, residencyId }: Props) {
  const [data, setData] = useState<GetAllocationBoardOutputType | null>(null);
  const [weekStart, setWeekStart] = useState(getCurrentServiceWeekStart());
  const [loading, setLoading] = useState(false);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [delegateTarget, setDelegateTarget] = useState<ActionTarget | null>(null);
  const [selfAllocTarget, setSelfAllocTarget] = useState<SelfAllocTarget | null>(null);
  const [guideApprovalChecked, setGuideApprovalChecked] = useState(false);
  const [selfAllocating, setSelfAllocating] = useState(false);
  const [applyWholeWeek, setApplyWholeWeek] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => { load(); }, [weekStart, residencyId]);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getAllocationBoard({ weekStartDate: weekStart, residencyId }));
    } catch { toast.error('Failed to load board'); }
    finally { setLoading(false); }
  };

  const handleMarkDone = async () => {
    if (!actionTarget) return;
    setMarking(true);
    try {
      await markServiceDone({ allocationId: actionTarget.cell.allocationId });
      toast.success('Service marked as done ✅');
      setActionTarget(null);
      await load();
    } catch { toast.error('Failed to mark done'); }
    finally { setMarking(false); }
  };

  const handleSelfAllocate = async () => {
    if (!selfAllocTarget || !guideApprovalChecked) return;
    setSelfAllocating(true);
    try {
      const days = applyWholeWeek ? DAYS : [selfAllocTarget.day];
      const res = await selfAllocate({ serviceId: selfAllocTarget.serviceId, weekStartDate: weekStart, days });
      toast.success(`Assigned yourself to ${selfAllocTarget.serviceName} (${res.created} day${res.created !== 1 ? 's' : ''}) ✓`);
      setSelfAllocTarget(null);
      setGuideApprovalChecked(false);
      setApplyWholeWeek(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to self-assign');
    } finally { setSelfAllocating(false); }
  };

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const isThisWeek = weekStart === getCurrentServiceWeekStart();

  return (
    <div className="space-y-4">
      {/* Week navigation — compact on mobile */}
      <div className="flex items-center gap-1.5">
        <button onClick={prevWeek} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted border shrink-0">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center min-w-0">
          <p className="font-semibold text-sm leading-tight">{weekLabel(weekStart)}</p>
          <p className="text-[11px] text-muted-foreground">{weekRange(weekStart)}</p>
        </div>
        <button onClick={nextWeek} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted border shrink-0">
          <ChevronRight className="w-4 h-4" />
        </button>
        {!isThisWeek && (
          <Button size="sm" variant="outline" onClick={() => setWeekStart(getCurrentServiceWeekStart())} className="text-xs h-8 px-2 shrink-0">
            Now
          </Button>
        )}
      </div>

      {loading && <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>}

      {data && !loading && (
        <>
          {/* Today's checklist */}
          <TodayServiceChecklist data={data} userId={userId} onRefresh={load} />

          {/* Stats — 2 cols on mobile, 4 on desktop */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Total',      value: data.summary.total,     color: 'text-foreground' },
              { label: '✅ Done',    value: data.summary.completed, color: 'text-green-600' },
              { label: '🔴 Overdue', value: data.summary.overdue,   color: 'text-destructive' },
              { label: '⏳ Pending', value: data.summary.pending,   color: 'text-primary' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="p-2.5 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Mobile: day-by-day card view */}
          <div className="block md:hidden">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Weekly Overview
                  <span className="text-xs font-normal text-muted-foreground ml-1">· tap to act</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <MobileDayView
                  data={data}
                  userId={userId}
                  weekStart={weekStart}
                  onAction={setActionTarget}
                  onSelfAlloc={setSelfAllocTarget}
                />
              </CardContent>
            </Card>
          </div>

          {/* Desktop: full allocation table */}
          <div className="hidden md:block">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Weekly Allocation Board
                  <span className="text-xs font-normal text-muted-foreground">(your services in blue · + to self-assign)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-xs min-w-[600px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-card">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground w-44">Service</th>
                      {DAY_LABELS.map((d, i) => (
                        <th key={d} className="text-center py-2 px-1 font-medium text-muted-foreground w-20">
                          <div>{d}</div>
                          <div className="text-[10px] text-muted-foreground/60">{format(addDays(new Date(weekStart), i), 'dd')}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.services.map(svc => (
                      <tr key={svc.serviceId} className="border-b last:border-0">
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium break-words leading-snug">{svc.serviceName}</div>
                          <div className="text-muted-foreground/70 mt-0.5 text-[10px]">{svc.timeSlot}</div>
                        </td>
                        {data.days.map((day, di) => {
                          const cells = data.grid[svc.serviceId]?.[day] ?? [];
                          const myCell = cells.find(c => c.userId === userId);
                          const alreadyAssigned = !!myCell;
                          return (
                            <td key={day} className="py-1 px-1 text-center align-top">
                              <div className="space-y-0.5">
                                {cells.map(c => {
                                  const isMe = c.userId === userId;
                                  const canAct = isMe && c.status !== 'completed' && c.status !== 'swapped';
                                  const cellClass = isMe ? (STATUS_CELL[c.status] ?? STATUS_CELL.assigned) : 'bg-muted/40 text-muted-foreground border-border';
                                  return (
                                    <div key={c.allocationId}
                                      onClick={() => canAct && setActionTarget({ cell: c, serviceName: svc.serviceName })}
                                      className={`rounded px-1.5 py-1 border ${cellClass} ${canAct ? 'cursor-pointer hover:opacity-80' : ''}`}
                                      title={isMe ? (canAct ? 'Tap to mark done or delegate' : c.status) : c.userName}
                                    >
                                      <div className="font-medium text-[11px] leading-snug">{c.userName.split(' ')[0]}</div>
                                      {canAct && <div className="text-[9px] opacity-60 mt-0.5">tap to act</div>}
                                    </div>
                                  );
                                })}
                                {!alreadyAssigned && (
                                  <button
                                    onClick={() => setSelfAllocTarget({ serviceId: svc.serviceId, serviceName: svc.serviceName, timeSlot: svc.timeSlot, day })}
                                    className="w-full flex items-center justify-center text-muted-foreground/40 hover:text-primary transition-colors py-0.5"
                                    title="Assign yourself"
                                  >
                                    <PlusCircle className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.services.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No allocations for this week yet.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Action dialog */}
      <AlertDialog open={!!actionTarget} onOpenChange={v => !v && setActionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>What happened with this service?</AlertDialogTitle>
            <AlertDialogDescription className="font-medium text-foreground">{actionTarget?.serviceName}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <AlertDialogAction onClick={handleMarkDone} disabled={marking} className="bg-green-600 hover:bg-green-700 text-white justify-start gap-2">
              <CheckCircle2 className="w-4 h-4" />{marking ? 'Marking…' : "I've Done It ✅"}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => { const t = actionTarget; setActionTarget(null); setDelegateTarget(t); }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground justify-start gap-2"
            >
              <ArrowLeftRight className="w-4 h-4" />Delegate / Request Swap
            </AlertDialogAction>
          </div>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Self-allocation dialog */}
      <Dialog open={!!selfAllocTarget} onOpenChange={v => { if (!v) { setSelfAllocTarget(null); setGuideApprovalChecked(false); setApplyWholeWeek(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Assign Yourself</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-muted/50 rounded-lg px-3 py-2">
              <p className="text-sm font-semibold">{selfAllocTarget?.serviceName}</p>
              <p className="text-xs text-muted-foreground">{selfAllocTarget?.timeSlot} · {selfAllocTarget?.day && DAY_LABELS[DAYS.indexOf(selfAllocTarget.day as typeof DAYS[number])]}</p>
            </div>
            <div className="flex items-start gap-2.5 p-3 rounded-lg border border-yellow-200 bg-yellow-50">
              <Checkbox id="guide-approval" checked={guideApprovalChecked} onCheckedChange={v => setGuideApprovalChecked(!!v)} className="mt-0.5 shrink-0" />
              <label htmlFor="guide-approval" className="text-xs leading-snug cursor-pointer text-yellow-900 font-medium">
                ✅ Yes, I have taken the approval from the Residency FOLK Guide before assigning myself to this service.
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="whole-week" checked={applyWholeWeek} onCheckedChange={v => setApplyWholeWeek(!!v)} />
              <label htmlFor="whole-week" className="text-xs cursor-pointer text-muted-foreground">Apply for the whole week</label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setSelfAllocTarget(null); setGuideApprovalChecked(false); setApplyWholeWeek(false); }}>Cancel</Button>
            <Button size="sm" onClick={handleSelfAllocate} disabled={!guideApprovalChecked || selfAllocating}>
              {selfAllocating ? 'Assigning…' : 'Assign Myself'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {delegateTarget && (
        <SwapRequestModal
          open={!!delegateTarget}
          onClose={() => setDelegateTarget(null)}
          allocationId={delegateTarget.cell.allocationId}
          serviceName={delegateTarget.serviceName}
          onRequested={() => { setDelegateTarget(null); load(); }}
        />
      )}
    </div>
  );
}
