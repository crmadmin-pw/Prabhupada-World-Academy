import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format, addDays } from 'date-fns';
import { Download, RefreshCw, Trash2, Pencil, PlusCircle, UserCheck, UserX, Bell, RotateCw, ClipboardList, CheckCircle, XCircle, Shield, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { getAllocationBoard, autoGenerateAllocation, updateAllocation, getResidentsForAllocation, createAllocation, getResidenciesForGuide, copyLastWeekAllocation, getServiceRotation, publishAllocation, getUnavailabilityRequests, approveUnavailability } from 'zite-endpoints-sdk';
import type { GetAllocationBoardOutputType, GetResidentsForAllocationOutputType, GetServiceRotationOutputType, GetUnavailabilityRequestsOutputType } from 'zite-endpoints-sdk';
import WeekPlannerDialog from './WeekPlannerDialog';

import { SERVICE_DAY_LABELS as DAY_LABELS, SERVICE_DAYS, getCurrentServiceWeekStart, getServiceWeekByOffset } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];
const TIME_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night', full_day: 'Full Day' };
const TIME_COLOR: Record<string, string> = { morning: 'bg-yellow-100 text-yellow-800', afternoon: 'bg-orange-100 text-orange-800', evening: 'bg-blue-100 text-blue-800', night: 'bg-purple-100 text-purple-800', full_day: 'bg-green-100 text-green-800' };
const ROTATION_COLORS: Record<string, string> = { fair: 'bg-green-500', repeating: 'bg-yellow-500', overloaded: 'bg-red-500' };
const ROTATION_LABELS: Record<string, string> = { fair: '🟢 Fair rotation', repeating: '🟡 Same service 2+ weeks in a row', overloaded: '🔴 Over-assigned — consider rotating' };
const STATUS_CELL: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 border-green-200',
  overdue: 'bg-red-100 text-red-800 border-red-200',
  swapped: 'bg-orange-100 text-orange-800 border-orange-200',
  assigned: 'bg-green-50 text-green-900 border-green-200',
};

function weekLabel(ws: string): string {
  const thisWeek = getCurrentServiceWeekStart();
  const nextWeek = format(addDays(new Date(thisWeek), 7), 'yyyy-MM-dd');
  const lastWeek = format(addDays(new Date(thisWeek), -7), 'yyyy-MM-dd');
  const start = new Date(ws + 'T00:00:00');
  const end = addDays(start, 6);
  const range = `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
  if (ws === thisWeek) return `This Week · ${range}`;
  if (ws === nextWeek) return `Next Week · ${range}`;
  if (ws === lastWeek) return `Last Week · ${range}`;
  return range;
}

type GridCell = GetAllocationBoardOutputType['grid'][string][string][0];
type Resident = GetResidentsForAllocationOutputType['residents'][0];
type RotationMap = GetServiceRotationOutputType['rotationMap'];
type LeaveRequest = GetUnavailabilityRequestsOutputType['requests'][0];

interface EditState { cell: GridCell; serviceId: string; day: string; }
interface AllocPopover { serviceId: string; serviceName: string; timeSlot: string; day: string; mode: 'primary' | 'backup'; existingPrimary?: string; }
interface Props { guideId?: string; residencyId?: string; serviceType?: string; }

function RotationDot({ userId, serviceId, rotationMap }: { userId: string; serviceId: string; rotationMap: RotationMap }) {
  const key = `${userId}::${serviceId}`;
  const info = rotationMap[key];
  if (!info || info.flag === 'fair') return null;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`w-2 h-2 rounded-full inline-block shrink-0 ${ROTATION_COLORS[info.flag]}`} />
        </TooltipTrigger>
        <TooltipContent className="text-xs">{ROTATION_LABELS[info.flag]} ({info.streak} weeks)</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Maps full day name to short service week key
const DAY_TO_SHORT: Record<string, string> = {
  Sunday: 'sun', Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed',
  Thursday: 'thu', Friday: 'fri', Saturday: 'sat',
};

export default function AllocationBoardTab({ guideId, residencyId: propResidencyId, serviceType }: Props) {
  const isWeekly = !serviceType || serviceType === 'Weekly';
  const [data, setData] = useState<GetAllocationBoardOutputType | null>(null);
  const [rotationMap, setRotationMap] = useState<RotationMap>({});
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residencyId, setResidencyId] = useState<string | undefined>(propResidencyId);
  const [weekStart, setWeekStart] = useState(getServiceWeekByOffset(1));
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GridCell | null>(null);
  const [allocPopover, setAllocPopover] = useState<AllocPopover | null>(null);
  const [applyWholeWeek, setApplyWholeWeek] = useState(true);
  const [allocatingUser, setAllocatingUser] = useState<string | null>(null);
  const [newUserId, setNewUserId] = useState('');
  const [showRotation, setShowRotation] = useState(true);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [weekPlannerOpen, setWeekPlannerOpen] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (propResidencyId) { setResidencyId(propResidencyId); return; }
    if (guideId) {
      getResidenciesForGuide({ guideId }).then(res => {
        if (res && res.length > 0) setResidencyId(res[0].residencyId);
      }).catch(() => {});
    }
  }, [guideId, propResidencyId]);

  useEffect(() => { load(); }, [weekStart, residencyId]);

  const load = async () => {
    setLoading(true);
    try {
      const [board, res, rotation] = await Promise.all([
        getAllocationBoard({ weekStartDate: weekStart, residencyId }),
        getResidentsForAllocation({ residencyId, weekStartDate: weekStart }).catch(() => ({ residents: [] })),
        getServiceRotation({ weekStartDate: weekStart, residencyId }).catch(() => ({ rotationMap: {} })),
      ]);
      setData(board);
      setResidents(res.residents);
      setRotationMap(rotation.rotationMap);
    } catch { toast.error('Failed to load board'); }
    finally { setLoading(false); }
  };

  const loadLeaveRequests = async () => {
    setLeaveLoading(true);
    try {
      const res = await getUnavailabilityRequests({ status: 'Pending' });
      setLeaveRequests(res.requests);
    } catch { toast.error('Failed to load leave requests'); }
    finally { setLeaveLoading(false); }
  };

  const handleApproveLeave = async (requestId: string, action: 'approve' | 'reject') => {
    setApprovingId(requestId);
    try {
      const res = await approveUnavailability({ requestId, action });
      const msg = action === 'approve'
        ? res.backupPromoted ? '✅ Approved — backup promoted to primary' : '✅ Approved — allocation needs reassignment'
        : '❌ Request rejected';
      toast.success(msg);
      await loadLeaveRequests();
      await load();
    } catch { toast.error('Failed to process request'); }
    finally { setApprovingId(null); }
  };

  const handleCopyLastWeek = async () => {
    setCopying(true);
    try {
      const res = await copyLastWeekAllocation({ thisWeekStartDate: weekStart, residencyId, skipUnavailable: true });
      if (res.alreadyExists) {
        toast.info('This week already has allocations. Clear them first to copy.');
      } else {
        toast.success(`📋 Copied ${res.copied} allocations (${res.skipped} skipped — unavailable)`);
        await load();
      }
    } catch { toast.error('Failed to copy last week'); }
    finally { setCopying(false); }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await autoGenerateAllocation({ weekStartDate: weekStart, scope: 'residency', residencyId, force: true });
      toast.success(`✨ ${res.allocationsCreated} services re-allocated`);
      await load();
    } catch { toast.error('Failed to regenerate'); }
    finally { setRegenerating(false); }
  };

  const handlePublishNotify = async () => {
    setPublishing(true);
    try {
      const res = await publishAllocation({ weekStartDate: weekStart, residencyId });
      setPublishedAt(res.publishedAt);
      toast.success('📣 Allocation published! Residents will be notified.');
    } catch { toast.error('Failed to publish'); }
    finally { setPublishing(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await updateAllocation({ allocationId: deleteTarget.recordId, delete: true } as any);
      toast.success('Allocation removed');
      setDeleteTarget(null);
      await load();
    } catch { toast.error('Failed to remove'); }
  };

  const handleReassign = async () => {
    if (!editState || !newUserId) return;
    try {
      await updateAllocation({ allocationId: editState.cell.recordId, userId: newUserId, reassignWholeWeek: true } as any);
      toast.success('Reassigned ✓');
      setEditState(null); setNewUserId('');
      await load();
    } catch { toast.error('Failed to reassign'); }
  };

  const handleAllocate = async (userId: string, userName: string) => {
    if (!allocPopover) return;
    setAllocatingUser(userId);
    try {
      // Non-weekly services always allocate for a single day; weekly respects the "whole week" checkbox
      const days = (isWeekly && applyWholeWeek) ? DAYS : [allocPopover.day];
      if (allocPopover.mode === 'backup') {
        // Find the primary allocation record and update its backupUser
        const cells = data?.grid[allocPopover.serviceId]?.[allocPopover.day] ?? [];
        const primary = cells.find(c => !c.isBackup);
        if (primary) {
          await updateAllocation({ allocationId: primary.recordId, backupUserId: userId } as any);
          toast.success(`Backup assigned: ${userName}`);
        }
      } else {
        const res = await createAllocation({ serviceId: allocPopover.serviceId, userId, weekStartDate: weekStart, days } as any);
        toast.success(`Allocated ${userName} (${res.created} day${res.created !== 1 ? 's' : ''})`);
      }
      setAllocPopover(null); setApplyWholeWeek(false);
      await load();
    } catch { toast.error('Failed to allocate'); }
    finally { setAllocatingUser(null); }
  };

  const exportImage = () => {
    if (!data) return;
    const services = data.services;
    const PAD = 16, COL_SVC = 160, COL_DAY = 88, ROW_H = 36, TH_H = 40, HDR_H = 52;
    const W = PAD * 2 + COL_SVC + data.days.length * COL_DAY;
    const H = HDR_H + TH_H + services.length * ROW_H + PAD;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const F = 'Arial, sans-serif';
    ctx.fillStyle = '#FEFDFB'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#E86209'; ctx.fillRect(0, 0, W, HDR_H);
    ctx.fillStyle = '#fff'; ctx.font = `bold 16px ${F}`; ctx.fillText('FOLK Service Allocation', PAD, 28);
    ctx.font = `11px ${F}`; ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${weekLabel(weekStart)}  ·  ${data.summary.completed}/${data.summary.total} completed`, PAD, 46);
    let y = HDR_H;
    ctx.fillStyle = '#F5F0E8'; ctx.fillRect(0, y, W, TH_H);
    ctx.fillStyle = '#000'; ctx.font = `bold 11px ${F}`; ctx.fillText('Service', PAD + 4, y + TH_H / 2 + 4);
    data.days.forEach((_, i) => {
      const x = PAD + COL_SVC + i * COL_DAY;
      ctx.textAlign = 'center'; ctx.fillText(DAY_LABELS[i], x + COL_DAY / 2, y + 16);
      ctx.font = `9px ${F}`; ctx.fillStyle = '#888';
      ctx.fillText(format(addDays(new Date(weekStart), i), 'dd MMM'), x + COL_DAY / 2, y + 30);
      ctx.font = `bold 11px ${F}`; ctx.fillStyle = '#000';
    });
    ctx.textAlign = 'left'; y += TH_H;
    services.forEach((svc, si) => {
      const ry = y + si * ROW_H;
      ctx.fillStyle = si % 2 === 0 ? '#fff' : '#F9F9F7'; ctx.fillRect(0, ry, W, ROW_H);
      ctx.strokeStyle = '#EDE8DC'; ctx.lineWidth = 0.5; ctx.strokeRect(0, ry, W, ROW_H);
      ctx.fillStyle = '#000'; ctx.font = `11px ${F}`;
      ctx.fillText(svc.serviceName.length > 22 ? svc.serviceName.slice(0, 21) + '…' : svc.serviceName, PAD + 4, ry + 16);
      ctx.fillStyle = '#888'; ctx.font = `9px ${F}`; ctx.fillText(svc.timeSlot, PAD + 4, ry + 28);
      data.days.forEach((d, di) => {
        const cx = PAD + COL_SVC + di * COL_DAY;
        const cells = data.grid[svc.serviceId]?.[d] ?? [];
        ctx.strokeStyle = '#EDE8DC'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(cx, ry); ctx.lineTo(cx, ry + ROW_H); ctx.stroke();
        if (cells.length === 0) { ctx.fillStyle = '#ccc'; ctx.font = `10px ${F}`; ctx.textAlign = 'center'; ctx.fillText('—', cx + COL_DAY / 2, ry + ROW_H / 2 + 4); }
        else { cells.forEach((c, ci) => { const bg = c.status === 'completed' ? '#dcfce7' : c.isOverdue ? '#fee2e2' : '#f0fdf4'; ctx.fillStyle = bg; ctx.fillRect(cx + 2, ry + ci * 16 + 2, COL_DAY - 4, 14); ctx.fillStyle = c.status === 'completed' ? '#166534' : c.isOverdue ? '#991b1b' : '#166534'; ctx.font = `9px ${F}`; ctx.textAlign = 'center'; ctx.fillText(c.userName.split(' ')[0], cx + COL_DAY / 2, ry + ci * 16 + 12); }); }
        ctx.textAlign = 'left';
      });
    });
    const link = document.createElement('a'); link.download = `allocation-board-${weekStart}.png`; link.href = canvas.toDataURL('image/png'); link.click();
  };

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const goToThisWeek = () => setWeekStart(getCurrentServiceWeekStart());
  const isThisWeek = weekStart === getCurrentServiceWeekStart();
  const isNextWeek = weekStart === getServiceWeekByOffset(1);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={prevWeek} className="px-2 py-1 text-sm rounded hover:bg-muted border">←</button>
          <p className="font-semibold text-sm">{weekLabel(weekStart)}</p>
          <button onClick={nextWeek} className="px-2 py-1 text-sm rounded hover:bg-muted border">→</button>
          {!isThisWeek && <Button size="sm" variant="outline" onClick={goToThisWeek} className="text-xs h-7">This Week</Button>}
          {!isNextWeek && <Button size="sm" variant="outline" onClick={() => setWeekStart(getServiceWeekByOffset(1))} className="text-xs h-7">Next Week</Button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleCopyLastWeek} disabled={copying}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${copying ? 'animate-spin' : ''}`} />{copying ? 'Copying…' : 'Copy Last Week'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />{regenerating ? 'Generating…' : 'Smart Assign'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekPlannerOpen(true)} disabled={!data}>
            <CalendarDays className="w-3.5 h-3.5 mr-1.5" />Week Planner
          </Button>
          <Button size="sm" variant="outline" onClick={exportImage} disabled={!data}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Export
          </Button>
          <Button size="sm" onClick={handlePublishNotify} disabled={publishing} className="gap-1.5">
            <Bell className="w-3.5 h-3.5" />{publishing ? 'Publishing…' : publishedAt ? '✓ Published' : 'Publish & Notify'}
          </Button>
        </div>
      </div>

      {publishedAt && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <Bell className="w-3.5 h-3.5 shrink-0" />
          Allocation published at {new Date(publishedAt).toLocaleTimeString()} — residents will see a notification banner on next visit
        </div>
      )}

      <Tabs defaultValue="board">
        <TabsList className="h-8">
          <TabsTrigger value="board" className="text-xs h-7">Allocation Board</TabsTrigger>
          <TabsTrigger value="leave" className="text-xs h-7 flex items-center gap-1.5" onClick={loadLeaveRequests}>
            <ClipboardList className="w-3 h-3" />Leave Requests
            {leaveRequests.length > 0 && (
              <span className="bg-destructive text-destructive-foreground rounded-full text-[9px] w-4 h-4 flex items-center justify-center ml-0.5">{leaveRequests.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4 space-y-4">
          {/* Rotation legend */}
          <div className="flex items-center gap-3 flex-wrap">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowRotation(v => !v)}>
              <RotateCw className="w-3 h-3" />Rotation: {showRotation ? 'ON' : 'OFF'}
            </button>
            {showRotation && (
              <>
                <span className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />Repeating (2+ weeks)</span>
                <span className="text-xs text-muted-foreground flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />Overloaded (3+ weeks)</span>
              </>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto"><Shield className="w-3 h-3 text-muted-foreground/50" />Dimmed = backup</span>
          </div>

          {loading && <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>}

          {data && !loading && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[{ label: 'Total', value: data.summary.total, color: 'text-foreground' }, { label: '✅ Done', value: data.summary.completed, color: 'text-green-600' }, { label: '🔴 Overdue', value: data.summary.overdue, color: 'text-destructive' }, { label: '⏳ Pending', value: data.summary.pending, color: 'text-blue-600' }].map(s => (
                  <Card key={s.label}><CardContent className="p-3 text-center"><p className={`text-xl font-bold ${s.color}`}>{s.value}</p><p className="text-xs text-muted-foreground mt-0.5">{s.label}</p></CardContent></Card>
                ))}
              </div>

              {data.summary.overdue > 0 && (
                <Card className="border-red-200 bg-red-50/50">
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">🔴 Overdue</CardTitle></CardHeader>
                  <CardContent className="pt-0 space-y-1">
                    {data.services.map(svc => data.days.map(day => (data.grid[svc.serviceId]?.[day] ?? []).filter(c => c.isOverdue || c.status === 'overdue').map(c => (
                      <div key={c.allocationId} className="flex items-center justify-between text-xs py-1 border-b border-red-100 last:border-0">
                        <span className="font-medium">{svc.serviceName}</span>
                        <span className="text-muted-foreground capitalize">{day}</span>
                        <span className="text-destructive font-medium">{c.userName}</span>
                      </div>
                    ))))}
                  </CardContent>
                </Card>
              )}

              {isWeekly ? (
                /* ── Weekly: 7-day grid table ── */
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      Allocation Grid
                      <span className="text-xs font-normal text-muted-foreground">(+ to allocate · hover name to manage)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 overflow-x-auto" ref={tableRef}>
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
                              <div className="text-muted-foreground/70 text-[10px] mt-0.5">{svc.timeSlot}</div>
                            </td>
                            {data.days.map((day, di) => {
                              const cells = data.grid[svc.serviceId]?.[day] ?? [];
                              const hasPrimary = cells.some(c => !c.isBackup);
                              const isOpen = allocPopover?.serviceId === svc.serviceId && allocPopover?.day === day;
                              return (
                                <td key={day} className="py-1 px-1 text-center align-top">
                                  <div className="space-y-0.5">
                                    {cells.filter(c => !c.isBackup).map(c => (
                                      <div key={c.allocationId} className={`flex flex-col gap-0 rounded px-1.5 py-0.5 border group ${STATUS_CELL[c.status] ?? STATUS_CELL.assigned}`} title={`${c.userName} — ${c.status}`}>
                                        <div className="flex items-center gap-0.5 justify-between">
                                          <span className="text-[10px] font-medium leading-tight">{c.userName.split(' ')[0]}</span>
                                          <div className="flex items-center gap-0.5 shrink-0">
                                            {showRotation && <RotationDot userId={c.userId} serviceId={svc.serviceId} rotationMap={rotationMap} />}
                                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <button onClick={() => { setEditState({ cell: c, serviceId: svc.serviceId, day }); setNewUserId((c as any).userDbId || ''); }} className="hover:text-primary"><Pencil className="w-2.5 h-2.5" /></button>
                                              <button onClick={() => setDeleteTarget(c)} className="hover:text-destructive"><Trash2 className="w-2.5 h-2.5" /></button>
                                            </div>
                                          </div>
                                        </div>
                                        {c.backupUserName && (
                                          <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground/60 mt-0.5">
                                            <Shield className="w-2 h-2" />
                                            <span className="truncate">{c.backupUserName.split(' ')[0]}</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                    <Popover open={isOpen} onOpenChange={open => { if (!open) { setAllocPopover(null); setApplyWholeWeek(false); } }}>
                                      <PopoverTrigger asChild>
                                        <button
                                          onClick={() => setAllocPopover({ serviceId: svc.serviceId, serviceName: svc.serviceName, timeSlot: svc.timeSlot, day, mode: 'primary' })}
                                          className="w-full flex items-center justify-center text-muted-foreground/40 hover:text-primary transition-colors py-0.5"
                                        >
                                          <PlusCircle className="w-3 h-3" />
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-64 p-0" align="start" side="bottom">
                                        <div className="px-3 py-2 border-b bg-muted/50 flex items-center justify-between">
                                          <div>
                                            <p className="text-xs font-semibold leading-snug">{svc.serviceName}</p>
                                            <p className="text-[10px] text-muted-foreground">{DAY_LABELS[di]} · {svc.timeSlot}</p>
                                          </div>
                                          {hasPrimary && (
                                            <div className="flex gap-1">
                                              <button onClick={() => setAllocPopover(prev => prev ? { ...prev, mode: 'primary' } : prev)} className={`text-[10px] px-1.5 py-0.5 rounded ${allocPopover?.mode !== 'backup' ? 'bg-primary text-primary-foreground' : 'border border-border'}`}>Primary</button>
                                              <button onClick={() => setAllocPopover(prev => prev ? { ...prev, mode: 'backup' } : prev)} className={`text-[10px] px-1.5 py-0.5 rounded ${allocPopover?.mode === 'backup' ? 'bg-primary text-primary-foreground' : 'border border-border'}`}>Backup</button>
                                            </div>
                                          )}
                                        </div>
                                        <div className="max-h-52 overflow-y-auto">
                                          {residents.length === 0 ? <p className="text-xs text-center py-4 text-muted-foreground">No residents found</p> : (
                                            <>
                                              {residents.filter(r => r.dayAvailability[day]).map(r => {
                                                const rot = rotationMap[`${r.userId}::${svc.serviceId}`];
                                                return (
                                                  <button key={r.userId} onClick={() => handleAllocate(r.userId, r.userName)} disabled={allocatingUser === r.userId}
                                                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted text-left border-b last:border-0 gap-2">
                                                    <span className="flex items-center gap-1 text-xs font-medium">
                                                      <UserCheck className="w-3 h-3 text-green-600 shrink-0" />{r.userName}
                                                      {rot && rot.flag !== 'fair' && <span className={`w-1.5 h-1.5 rounded-full inline-block ${ROTATION_COLORS[rot.flag]}`} />}
                                                    </span>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TIME_COLOR[r.dayAvailability[day]!] ?? 'bg-muted'}`}>{TIME_LABEL[r.dayAvailability[day]!] ?? r.dayAvailability[day]}</span>
                                                  </button>
                                                );
                                              })}
                                              {residents.filter(r => !r.dayAvailability[day]).map(r => (
                                                <button key={r.userId} onClick={() => handleAllocate(r.userId, r.userName)} disabled={allocatingUser === r.userId}
                                                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted text-left border-b last:border-0 opacity-60 gap-2">
                                                  <span className="flex items-center gap-1 text-xs"><UserX className="w-3 h-3 text-muted-foreground shrink-0" />{r.userName}</span>
                                                  <span className="text-[10px] text-muted-foreground">Not avail.</span>
                                                </button>
                                              ))}
                                            </>
                                          )}
                                        </div>
                                        {allocPopover?.mode !== 'backup' && (
                                          <div className="px-3 py-2 border-t flex items-center gap-2 bg-muted/30">
                                            <Checkbox id={`ww-${svc.serviceId}-${day}`} checked={applyWholeWeek} onCheckedChange={v => setApplyWholeWeek(!!v)} />
                                            <label htmlFor={`ww-${svc.serviceId}-${day}`} className="text-xs cursor-pointer select-none">Apply for whole week</label>
                                          </div>
                                        )}
                                      </PopoverContent>
                                    </Popover>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.services.length === 0 && (
                      <div className="text-center py-10 text-muted-foreground">
                        <p className="text-sm font-medium mb-1">No services found for this residency.</p>
                        <p className="text-xs">Add services first from the <strong>Services</strong> tab, then use <strong>Smart Assign</strong> to allocate them.</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                /* ── Non-Weekly: card-based assignment view ── */
                <div className="space-y-3">
                  {data.services.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground border rounded-lg">
                      <p className="text-sm font-medium mb-1">No services found.</p>
                      <p className="text-xs">Add services from the <strong>Services</strong> tab first.</p>
                    </div>
                  )}
                  {data.services.map(svc => {
                    // Parse preferred days from customFieldsJson
                    let preferredDays: string[] = [];
                    try { const p = JSON.parse((svc as any).customFieldsJson || '[]'); if (Array.isArray(p)) preferredDays = p; } catch {}

                    // Flatten all day cells and dedupe by allocationId
                    const allCells = data.days.flatMap(d => data.grid[svc.serviceId]?.[d] ?? []);
                    const uniqueCells = allCells.filter((c, i, a) => a.findIndex(x => x.allocationId === c.allocationId) === i).filter(c => !c.isBackup);

                    // Day to use when creating a new allocation: first preferred day, or 'sat' default
                    const allocDay = preferredDays.length > 0 ? (DAY_TO_SHORT[preferredDays[0]] || 'sat') : 'sat';
                    const isOpen = allocPopover?.serviceId === svc.serviceId;

                    return (
                      <Card key={svc.serviceId}>
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            {/* Service info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{svc.serviceName}</span>
                                <span className="text-xs text-muted-foreground">{svc.timeSlot}</span>
                              </div>
                              {/* Preferred days badges */}
                              {preferredDays.length > 0 ? (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  <span className="text-xs text-muted-foreground">Due:</span>
                                  {preferredDays.map(d => (
                                    <Badge key={d} variant="secondary" className="text-xs py-0">{d}</Badge>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground mt-1">Any day this week</p>
                              )}
                            </div>
                            {/* Assign button */}
                            <Popover open={isOpen} onOpenChange={open => { if (!open) setAllocPopover(null); }}>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs"
                                  onClick={() => setAllocPopover({ serviceId: svc.serviceId, serviceName: svc.serviceName, timeSlot: svc.timeSlot, day: allocDay, mode: 'primary' })}>
                                  <PlusCircle className="w-3.5 h-3.5" />Assign
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-64 p-0" align="end">
                                <div className="px-3 py-2 border-b bg-muted/50">
                                  <p className="text-xs font-semibold leading-snug">{svc.serviceName}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {preferredDays.length > 0 ? preferredDays.join(' or ') : 'Any day'} · {svc.timeSlot}
                                  </p>
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                  {residents.length === 0 ? (
                                    <p className="text-xs text-center py-4 text-muted-foreground">No residents found</p>
                                  ) : residents.map(r => {
                                    const rot = rotationMap[`${r.userId}::${svc.serviceId}`];
                                    const alreadyAssigned = uniqueCells.some(c => c.userId === r.userId);
                                    return (
                                      <button key={r.userId} onClick={() => handleAllocate(r.userId, r.userName)}
                                        disabled={allocatingUser === r.userId || alreadyAssigned}
                                        className={`w-full flex items-center justify-between px-3 py-2 hover:bg-muted text-left border-b last:border-0 gap-2 ${alreadyAssigned ? 'opacity-40' : ''}`}>
                                        <span className="flex items-center gap-1.5 text-xs font-medium">
                                          <UserCheck className="w-3 h-3 text-green-600 shrink-0" />
                                          {r.userName}
                                          {rot && rot.flag !== 'fair' && <span className={`w-1.5 h-1.5 rounded-full inline-block ${ROTATION_COLORS[rot.flag]}`} title={ROTATION_LABELS[rot.flag]} />}
                                        </span>
                                        {alreadyAssigned && <span className="text-[10px] text-muted-foreground">Assigned</span>}
                                      </button>
                                    );
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* Assigned people */}
                          {uniqueCells.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {uniqueCells.map(c => (
                                <div key={c.allocationId} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs group ${STATUS_CELL[c.status] ?? STATUS_CELL.assigned}`}>
                                  <div className="flex items-center gap-2">
                                    {showRotation && <RotationDot userId={c.userId} serviceId={svc.serviceId} rotationMap={rotationMap} />}
                                    <span className="font-medium">{c.userName}</span>
                                    {c.status === 'completed' && <span className="text-green-600 font-medium">✓ Done</span>}
                                    {(c.isOverdue || c.status === 'overdue') && <span className="text-destructive font-medium">Overdue</span>}
                                    {c.backupUserName && (
                                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60 ml-1">
                                        <Shield className="w-3 h-3" />{c.backupUserName.split(' ')[0]}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => { setEditState({ cell: c, serviceId: svc.serviceId, day: allocDay }); setNewUserId((c as any).userDbId || ''); }} className="hover:text-primary p-0.5"><Pencil className="w-3 h-3" /></button>
                                    <button onClick={() => setDeleteTarget(c)} className="hover:text-destructive p-0.5"><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {uniqueCells.length === 0 && (
                            <p className="mt-3 text-xs text-muted-foreground italic">No one assigned yet — click Assign to add someone.</p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="leave" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" />Pending Leave Requests
                </CardTitle>
                <Button size="sm" variant="outline" onClick={loadLeaveRequests} disabled={leaveLoading} className="h-7 text-xs">
                  <RefreshCw className={`w-3 h-3 mr-1 ${leaveLoading ? 'animate-spin' : ''}`} />Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {leaveLoading && <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>}
              {!leaveLoading && leaveRequests.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p>No pending leave requests</p>
                </div>
              )}
              {!leaveLoading && leaveRequests.length > 0 && (
                <div className="space-y-2">
                  {leaveRequests.map(req => (
                    <div key={req.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border bg-card">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{req.userName}</span>
                          <Badge variant="outline" className="text-xs">{req.date ? format(new Date(req.date), 'd MMM yyyy') : '—'}</Badge>
                          {req.serviceName && <Badge variant="secondary" className="text-xs">{req.serviceName}</Badge>}
                        </div>
                        {req.reason && <p className="text-xs text-muted-foreground mt-1 truncate">{req.reason}</p>}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Submitted {req.createdAt ? format(new Date(req.createdAt), 'd MMM, h:mm a') : ''}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                          disabled={approvingId === req.id}
                          onClick={() => handleApproveLeave(req.id, 'approve')}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-destructive text-destructive hover:bg-destructive/10"
                          disabled={approvingId === req.id}
                          onClick={() => handleApproveLeave(req.id, 'reject')}
                        >
                          <XCircle className="w-3 h-3 mr-1" />Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reassign dialog */}
      <Dialog open={!!editState} onOpenChange={v => !v && setEditState(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-sm">Reassign Allocation</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground">Currently: <strong>{editState?.cell.userName}</strong></p>
            <Select value={newUserId} onValueChange={setNewUserId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select resident…" /></SelectTrigger>
              <SelectContent>
                {residents.map(r => <SelectItem key={r.userId} value={(r as any).dbId || r.userId}>{r.userName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setEditState(null)}>Cancel</Button>
            <Button size="sm" onClick={handleReassign} disabled={!newUserId}>Reassign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WeekPlannerDialog
        open={weekPlannerOpen}
        onClose={() => setWeekPlannerOpen(false)}
        data={data}
        residents={residents}
        weekStart={weekStart}
        residencyId={residencyId}
        onSaved={load}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Allocation?</AlertDialogTitle>
            <AlertDialogDescription>Remove <strong>{deleteTarget?.userName}</strong>'s allocation? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
