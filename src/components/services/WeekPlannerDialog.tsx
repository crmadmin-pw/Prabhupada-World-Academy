import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { seedWeeklyAllocations } from 'zite-endpoints-sdk';
import type { GetAllocationBoardOutputType, GetResidentsForAllocationOutputType } from 'zite-endpoints-sdk';

import { SERVICE_DAYS } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];

type BoardData = GetAllocationBoardOutputType;
type Resident = GetResidentsForAllocationOutputType['residents'][0];

interface Props {
  open: boolean;
  onClose: () => void;
  data: BoardData | null;
  residents: Resident[];
  weekStart: string;
  residencyId?: string;
  onSaved: () => void;
}

export default function WeekPlannerDialog({ open, onClose, data, residents, weekStart, residencyId, onSaved }: Props) {
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !data) return;
    const init: Record<string, string[]> = {};
    for (const svc of data.services) {
      const needed = (svc as any).peopleNeeded || 1;
      const assigned: string[] = [];
      for (const day of DAYS) {
        const cells = data.grid[svc.serviceId]?.[day] ?? [];
        for (const cell of cells.filter((c: any) => !c.isBackup)) {
          const resident = residents.find(r => r.userName === cell.userName);
          if (resident && !assigned.includes(resident.userId)) {
            assigned.push(resident.userId); // userId used as stable key for select value
          }
        }
        if (assigned.length >= needed) break;
      }
      while (assigned.length < needed) assigned.push('');
      init[svc.serviceId] = assigned;
    }
    setAssignments(init);
  }, [open, data, residents]);

  const setSlot = (serviceId: string, slotIdx: number, userId: string) => {
    setAssignments(prev => {
      const arr = [...(prev[serviceId] || [])];
      arr[slotIdx] = userId;
      return { ...prev, [serviceId]: arr };
    });
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const assignmentsPayload = data.services
        .map(svc => {
          const userIds = assignments[svc.serviceId] || [];
          const assigneeNames = userIds
            .filter(Boolean)
            .map(uid => residents.find(r => r.userId === uid)?.userName || '')
            .filter(Boolean);
          return { serviceName: svc.serviceName, assignees: assigneeNames };
        })
        .filter(a => a.assignees.length > 0);

      const res = await seedWeeklyAllocations({
        weekStartDate: weekStart,
        residencyId,
        force: true,
        assignments: assignmentsPayload,
      });

      toast.success(`✅ Week planned — ${(res as any).totalAllocationsCreated} allocations created`);
      onClose();
      onSaved();
    } catch {
      toast.error('Failed to save week plan');
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            📋 Week Planner
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Assign residents to each service for the entire week. Saving will replace all existing allocations for this week.
          </p>
        </DialogHeader>

        <div className="space-y-2 py-1">
          {data.services.map(svc => {
            const needed = (svc as any).peopleNeeded || 1;
            const slots = assignments[svc.serviceId] || Array(needed).fill('');
            return (
              <div key={svc.serviceId} className="flex items-start gap-3 p-2.5 rounded-lg border bg-card">
                <div className="flex-1 min-w-0 pt-1">
                  <p className="text-sm font-medium leading-tight truncate">{svc.serviceName}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{svc.timeSlot}</p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0 w-44">
                  {Array.from({ length: needed }).map((_, i) => (
                    <Select
                      key={i}
                      value={slots[i] || ''}
                      onValueChange={v => setSlot(svc.serviceId, i, v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder={needed > 1 ? `Person ${i + 1}…` : 'Select person…'} />
                      </SelectTrigger>
                      <SelectContent>
                        {residents.map(r => (
                          <SelectItem key={r.userId} value={r.userId}>
                            {r.userName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ))}
                </div>
              </div>
            );
          })}

          {data.services.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              No services found. Add services first from the Services tab.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || data.services.length === 0}>
            {saving ? 'Saving…' : '💾 Save Week'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
