import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface GridService    { id: string; name: string; }
export interface GridResident  { id: string; name: string; }
export interface GridAssignment { userId: string; userName: string; dayOfWeek: string; }
export type CellEdit = { userId: string; dayOfWeek: string } | null; // null = pending clear

interface Props {
  services: GridService[];
  weekDates: string[];
  currentWeekDate: string;
  grid: Record<string, Record<string, GridAssignment[]>>;
  residents: GridResident[];
  edits: Record<string, Record<string, CellEdit>>;
  onChange: (serviceId: string, weekDate: string, userId: string, dayOfWeek: string) => void;
  onClear: (serviceId: string, weekDate: string) => void;
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function fmtYear(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').getFullYear();
}

interface CellProps {
  assignments: GridAssignment[];
  edit: CellEdit | undefined;
  residents: GridResident[];
  isCurrent: boolean;
  isPast: boolean;
  onSave: (userId: string, dayOfWeek: string) => void;
  onClear: () => void;
}

function ServiceWeekCell({ assignments, edit, residents, isCurrent, isPast, onSave, onClear }: CellProps) {
  const [open, setOpen] = useState(false);
  const [selUser, setSelUser] = useState('');
  const [selDay, setSelDay] = useState('Monday');

  const handleOpen = (o: boolean) => {
    if (o) {
      // Seed form with existing or pending edit
      const src = edit !== undefined ? edit : assignments[0] ?? null;
      setSelUser(src?.userId ?? '');
      setSelDay(src?.dayOfWeek ?? 'Monday');
    }
    setOpen(o);
  };

  // What to display in the cell
  const hasPendingEdit = edit !== undefined;
  const isPendingClear = edit === null;
  const displayItems: GridAssignment[] = hasPendingEdit && !isPendingClear
    ? [{ userId: edit!.userId, userName: residents.find(r => r.id === edit!.userId)?.name ?? '', dayOfWeek: edit!.dayOfWeek }]
    : edit === undefined
    ? assignments
    : [];

  if (isPast) {
    return (
      <td className="px-3 py-2.5 text-center border-b border-r border-border bg-muted/20 min-w-[110px]">
        {assignments.length > 0 ? (
          <div className="space-y-0.5">
            {assignments.slice(0, 2).map((a, i) => (
              <div key={i} className="text-xs leading-snug">
                <span className="font-medium">{a.userName.split(' ')[0]}</span>
                {a.dayOfWeek && (
                  <span className="text-muted-foreground text-[10px] ml-1">{a.dayOfWeek.slice(0, 3)}</span>
                )}
              </div>
            ))}
            {assignments.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{assignments.length - 2} more</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </td>
    );
  }

  return (
    <td className={`px-1 py-1 border-b border-r border-border min-w-[120px] transition-colors
      ${isCurrent ? 'bg-primary/5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]' : ''}
      ${isPendingClear ? 'bg-amber-50/60' : ''}
      ${hasPendingEdit && !isPendingClear ? 'bg-primary/10' : ''}
    `}>
      <Popover open={open} onOpenChange={handleOpen}>
        <PopoverTrigger className="w-full px-2 py-1.5 rounded text-left hover:bg-muted/50 transition-colors min-h-[36px] flex items-center justify-center group">
          {isPendingClear ? (
            <span className="text-[10px] text-amber-600 italic">clearing…</span>
          ) : displayItems.length > 0 ? (
            <div className="space-y-0.5 w-full text-center">
              {displayItems.slice(0, 2).map((a, i) => (
                <div key={i} className="text-xs leading-snug">
                  <span className={`font-medium ${hasPendingEdit ? 'text-primary' : ''}`}>
                    {a.userName.split(' ')[0]}
                  </span>
                  {a.dayOfWeek && (
                    <span className="text-muted-foreground text-[10px] ml-1">{a.dayOfWeek.slice(0, 3)}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground/40 text-lg group-hover:text-muted-foreground/70 transition-colors">＋</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3 space-y-2.5" align="center" side="bottom">
          <p className="text-xs font-semibold text-foreground">Assign Resident</p>
          <Select value={selUser} onValueChange={setSelUser}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select resident…" /></SelectTrigger>
            <SelectContent>
              {residents.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selDay} onValueChange={setSelDay}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="flex-1 h-7 text-xs"
              disabled={!selUser}
              onClick={() => { onSave(selUser, selDay); setOpen(false); }}
            >
              Apply
            </Button>
            {(assignments.length > 0 || (hasPendingEdit && !isPendingClear)) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={() => { onClear(); setOpen(false); }}
              >
                Clear
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </td>
  );
}

export default function AllocationExportGrid({
  services, weekDates, currentWeekDate, grid, residents, edits, onChange, onClear,
}: Props) {
  if (services.length === 0) return (
    <div className="rounded-lg border border-border bg-card p-12 text-center text-muted-foreground text-sm">
      No active services found for this type and residency.
    </div>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            {/* Sticky service column header */}
            <th className="sticky left-0 z-20 bg-muted min-w-[200px] max-w-[240px] px-4 py-3 text-left font-semibold border-b border-r border-border text-xs uppercase tracking-wide text-muted-foreground">
              Service
            </th>
            {weekDates.map(wd => {
              const isCurrent = wd === currentWeekDate;
              const isPast = wd < currentWeekDate;
              return (
                <th
                  key={wd}
                  className={`px-3 py-3 text-center font-semibold border-b border-r border-border min-w-[120px] text-xs whitespace-nowrap
                    ${isCurrent
                      ? 'bg-primary/10 text-primary border-b-2 border-b-primary'
                      : isPast
                      ? 'bg-muted/60 text-muted-foreground'
                      : 'bg-muted text-foreground'
                    }`}
                >
                  <div>{fmtDate(wd)}</div>
                  {isCurrent && <div className="text-[10px] font-normal opacity-70 mt-0.5">This week</div>}
                  {isPast && <div className="text-[10px] font-normal opacity-50 mt-0.5">{fmtYear(wd)}</div>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {services.map((svc, si) => (
            <tr key={svc.id} className={si % 2 === 0 ? 'bg-card' : 'bg-muted/10'}>
              {/* Sticky service name */}
              <td className={`sticky left-0 z-10 px-4 py-2.5 font-medium border-b border-r border-border text-sm whitespace-nowrap ${si % 2 === 0 ? 'bg-card' : 'bg-muted/10'}`}>
                {svc.name}
              </td>
              {weekDates.map(wd => (
                <ServiceWeekCell
                  key={wd}
                  assignments={grid[svc.id]?.[wd] ?? []}
                  edit={edits[svc.id]?.[wd]}
                  residents={residents}
                  isCurrent={wd === currentWeekDate}
                  isPast={wd < currentWeekDate}
                  onSave={(userId, dayOfWeek) => onChange(svc.id, wd, userId, dayOfWeek)}
                  onClear={() => onClear(svc.id, wd)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
