import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { LayoutGrid, List, Download, ChevronDown, ChevronRight, Users, Calendar, XCircle, TrendingUp, Smartphone, Clock } from 'lucide-react';
import { getMissingSadhanaReport, getAllResidencies } from 'zite-endpoints-sdk';
import { exportToCsv } from '@/utils/exportCsv';
import { toast } from 'sonner';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, subMonths, format,
} from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────────

type CellStatus = 'filled' | 'late' | 'missed';

type UserRow = {
  id: string;
  fullName: string;
  userId: string;
  residencyName: string;
  guideName: string;
  guideId: string;
  residencyType: string;
};
type ReportData = {
  users: UserRow[];
  dates: string[];
  matrix: Record<string, Record<string, CellStatus>>;
  stats: { totalUsers: number; totalDays: number; totalMissing: number; totalLate: number; completionRate: number };
  guides: { id: string; name: string }[];
};
type Period = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom';
type ViewMode = 'matrix' | 'list' | 'cards';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateRange(period: Period, cStart: string, cEnd: string): { start: string; end: string } {
  const today = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (period) {
    case 'this-week':  return { start: fmt(startOfWeek(today, { weekStartsOn: 1 })), end: fmt(endOfWeek(today, { weekStartsOn: 1 })) };
    case 'last-week':  { const s = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1); return { start: fmt(s), end: fmt(endOfWeek(s, { weekStartsOn: 1 })) }; }
    case 'this-month': return { start: fmt(startOfMonth(today)), end: fmt(endOfMonth(today)) };
    case 'last-month': { const m = subMonths(today, 1); return { start: fmt(startOfMonth(m)), end: fmt(endOfMonth(m)) }; }
    case 'custom':     return { start: cStart, end: cEnd };
  }
}

const rateColor = (r: number) =>
  r >= 80 ? 'text-green-600 dark:text-green-400' : r >= 60 ? 'text-yellow-600 dark:text-yellow-400' : 'text-destructive';

function StatusBadge({ type }: { type: string }) {
  if (type === 'Scholar') return <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">Scholar</span>;
  if (type === 'Resident') return <span className="text-[10px] font-medium text-green-600 dark:text-green-400">Resident</span>;
  return <span className="text-[10px] text-muted-foreground">Non-Res</span>;
}

// ─── Cell Indicator ───────────────────────────────────────────────────────────

function CellIndicator({ status, size = 'sm' }: { status: CellStatus; size?: 'sm' | 'xs' }) {
  if (status === 'filled') {
    return <span className={`font-bold ${size === 'sm' ? 'text-sm' : 'text-xs'} text-green-600 dark:text-green-400`}>✓</span>;
  }
  if (status === 'late') {
    return (
      <span className={`font-bold ${size === 'sm' ? 'text-sm' : 'text-xs'} text-amber-600 dark:text-amber-400`}>L</span>
    );
  }
  // Missed: red filled circle with white ✗
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-destructive text-white font-bold leading-none"
      style={{ width: size === 'sm' ? '18px' : '14px', height: size === 'sm' ? '18px' : '14px', fontSize: size === 'sm' ? '10px' : '8px' }}
    >
      ✕
    </span>
  );
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function StatsRow({ stats }: { stats: ReportData['stats'] }) {
  const cards = [
    { label: 'Total Users',     value: stats.totalUsers,    icon: Users,      sub: 'in scope' },
    { label: 'Days in Range',   value: stats.totalDays,     icon: Calendar,   sub: 'days checked' },
    { label: 'Missing Entries', value: stats.totalMissing,  icon: XCircle,    sub: 'not submitted', highlight: stats.totalMissing > 0 },
    { label: 'Late Entries',    value: stats.totalLate,     icon: Clock,      sub: 'filled next day+', lateHighlight: stats.totalLate > 0 },
    { label: 'Completion Rate', value: `${stats.completionRate}%`, icon: TrendingUp, sub: 'filled (incl. late)', rateVal: stats.completionRate },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-muted shrink-0 mt-0.5">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className={`text-xl font-bold leading-tight ${c.rateVal !== undefined ? rateColor(c.rateVal) : ''} ${c.highlight ? 'text-destructive' : ''} ${c.lateHighlight ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {c.value}
              </p>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">{c.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-green-600 dark:text-green-400">✓</span> On time
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-amber-600 dark:text-amber-400">L</span> Late (next day or later)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-flex items-center justify-center rounded-full bg-destructive text-white font-bold leading-none" style={{ width: '14px', height: '14px', fontSize: '8px' }}>✕</span> Missed
      </span>
    </div>
  );
}

// ─── Matrix View ──────────────────────────────────────────────────────────────

// Column order: Name(0) → Missed+Late(140) → Guide(192, md+) → Center(292, md+) → Status(382, md+) → dates
const STICKY = {
  name:   { left: '0px',   width: '140px' },
  missed: { left: '140px', width: '60px'  },
  guide:  { left: '200px', width: '100px' },
  center: { left: '300px', width: '90px'  },
  status: { left: '390px', width: '70px'  },
} as const;

function MatrixView({ data }: { data: ReportData }) {
  const { users, dates, matrix } = data;
  if (users.length === 0) return <p className="text-center text-sm text-muted-foreground py-8">No users found.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="text-xs w-full">
        <thead>
          <tr className="bg-muted">
            {/* Name */}
            <th style={{ left: STICKY.name.left, minWidth: STICKY.name.width }} className="sticky z-20 bg-muted text-left px-3 py-2.5 font-semibold border-r border-border">
              Name
            </th>
            {/* Missed/Late count — always visible */}
            <th style={{ left: STICKY.missed.left, minWidth: STICKY.missed.width }} className="sticky z-20 bg-muted text-center px-1 py-2.5 font-semibold border-r border-border">
              <div className="flex flex-col items-center leading-tight">
                <span className="text-destructive">✗</span>
                <span className="text-amber-600 dark:text-amber-400 text-[9px]">L</span>
              </div>
            </th>
            {/* Guide — hidden on mobile */}
            <th style={{ left: STICKY.guide.left, minWidth: STICKY.guide.width }} className="hidden md:table-cell sticky z-20 bg-muted text-left px-3 py-2.5 font-semibold border-r border-border/60">
              Guide
            </th>
            {/* Center — hidden on mobile */}
            <th style={{ left: STICKY.center.left, minWidth: STICKY.center.width }} className="hidden md:table-cell sticky z-20 bg-muted text-left px-3 py-2.5 font-semibold border-r border-border/60">
              Center
            </th>
            {/* Status — hidden on mobile */}
            <th style={{ left: STICKY.status.left, minWidth: STICKY.status.width }} className="hidden md:table-cell sticky z-20 bg-muted text-center px-2 py-2.5 font-semibold border-r border-border">
              Status
            </th>
            {/* Date columns */}
            {dates.map(date => (
              <th
                key={date}
                className="px-1.5 py-2 font-medium text-center min-w-[34px] text-muted-foreground"
                title={format(new Date(date + 'T00:00:00'), 'EEEE, MMM d yyyy')}
              >
                <div className="text-[10px] leading-none">{format(new Date(date + 'T00:00:00'), 'EEE')[0]}</div>
                <div className="font-semibold text-foreground">{format(new Date(date + 'T00:00:00'), 'd')}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u, idx) => {
            const userDates = matrix[u.id] || {};
            const missedCount = dates.filter(d => userDates[d] === 'missed').length;
            const lateCount = dates.filter(d => userDates[d] === 'late').length;
            const highlight = dates.length > 0 && missedCount / dates.length > 0.5;
            const rowBg = highlight ? 'bg-destructive/5' : idx % 2 === 0 ? 'bg-background' : 'bg-muted/10';
            return (
              <tr key={u.id} className={`border-t border-border/40 transition-colors hover:bg-muted/30 ${rowBg}`}>
                {/* Name */}
                <td style={{ left: STICKY.name.left, minWidth: STICKY.name.width }} className={`sticky z-10 ${rowBg} px-3 py-1.5 border-r border-border/40`}>
                  <span className="font-medium leading-tight">{u.fullName}</span>
                </td>
                {/* Missed/Late count — always visible */}
                <td style={{ left: STICKY.missed.left, minWidth: STICKY.missed.width }} className={`sticky z-10 ${rowBg} px-1 py-1.5 text-center border-r border-border/40`}>
                  <div className="flex flex-col items-center leading-tight">
                    <span className={`font-bold text-xs ${missedCount > 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
                      {missedCount}
                    </span>
                    {lateCount > 0 && (
                      <span className="font-bold text-[10px] text-amber-600 dark:text-amber-400">{lateCount}L</span>
                    )}
                  </div>
                </td>
                {/* Guide — hidden on mobile */}
                <td style={{ left: STICKY.guide.left, minWidth: STICKY.guide.width }} className={`hidden md:table-cell sticky z-10 ${rowBg} px-3 py-1.5 border-r border-border/20`}>
                  <span className="text-xs text-muted-foreground truncate block">{u.guideName || '—'}</span>
                </td>
                {/* Center — hidden on mobile */}
                <td style={{ left: STICKY.center.left, minWidth: STICKY.center.width }} className={`hidden md:table-cell sticky z-10 ${rowBg} px-3 py-1.5 border-r border-border/20`}>
                  <span className="text-xs text-muted-foreground truncate block">{u.residencyName ? u.residencyName.replace(/^FOLK\s+/i, '') : '—'}</span>
                </td>
                {/* Status — hidden on mobile */}
                <td style={{ left: STICKY.status.left, minWidth: STICKY.status.width }} className={`hidden md:table-cell sticky z-10 ${rowBg} px-2 py-1.5 text-center border-r border-border/40`}>
                  <StatusBadge type={u.residencyType} />
                </td>
                {/* Date cells */}
                {dates.map(date => {
                  const status: CellStatus = userDates[date] || 'missed';
                  return (
                    <td key={date} className="text-center px-1 py-1.5" title={status === 'filled' ? 'On time' : status === 'late' ? 'Late submission' : 'Missed'}>
                      <CellIndicator status={status} />
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Summary row: missing + late count per date */}
          <tr className="border-t-2 border-border bg-muted font-semibold">
            <td style={{ left: STICKY.name.left }} className="sticky z-10 bg-muted px-3 py-2 border-r border-border/40 text-xs text-muted-foreground">
              Per day
            </td>
            <td style={{ left: STICKY.missed.left }} className="sticky z-10 bg-muted border-r border-border/40" />
            <td style={{ left: STICKY.guide.left }} className="hidden md:table-cell sticky z-10 bg-muted border-r border-border/20" />
            <td style={{ left: STICKY.center.left }} className="hidden md:table-cell sticky z-10 bg-muted border-r border-border/20" />
            <td style={{ left: STICKY.status.left }} className="hidden md:table-cell sticky z-10 bg-muted border-r border-border/40" />
            {dates.map(date => {
              const missedDay = users.filter(u => matrix[u.id]?.[date] === 'missed').length;
              const lateDay = users.filter(u => matrix[u.id]?.[date] === 'late').length;
              return (
                <td key={date} className="text-center px-1 py-2">
                  <div className="flex flex-col items-center leading-tight">
                    {missedDay > 0 ? (
                      <span className="text-destructive text-[11px] font-semibold">{missedDay}</span>
                    ) : (
                      <span className="text-muted-foreground text-[11px]">—</span>
                    )}
                    {lateDay > 0 && (
                      <span className="text-amber-600 dark:text-amber-400 text-[10px]">{lateDay}L</span>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ data }: { data: ReportData }) {
  const { users, dates, matrix } = data;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    dates.forEach(d => {
      if (users.some(u => matrix[u.id]?.[d] !== 'filled')) s.add(d);
    });
    return s;
  });

  const reversedDates = [...dates].reverse();
  if (users.length === 0) return <p className="text-center text-sm text-muted-foreground py-8">No users found.</p>;

  return (
    <div className="space-y-2">
      {reversedDates.map(date => {
        const missing = users.filter(u => matrix[u.id]?.[date] === 'missed');
        const late = users.filter(u => matrix[u.id]?.[date] === 'late');
        const isOpen = expanded.has(date);
        const toggle = () => setExpanded(prev => {
          const next = new Set(prev);
          if (isOpen) next.delete(date); else next.add(date);
          return next;
        });
        const dateLabel = format(new Date(date + 'T00:00:00'), 'EEEE, MMM d');
        const allGood = missing.length === 0 && late.length === 0;
        return (
          <Collapsible key={date} open={isOpen} onOpenChange={toggle}>
            <CollapsibleTrigger asChild>
              <button
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors text-left"
                onClick={toggle}
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <span className="font-medium text-sm">{dateLabel}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {allGood ? (
                    <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400 border-green-500/40">All submitted 🎉</Badge>
                  ) : (
                    <>
                      {missing.length > 0 && (
                        <Badge variant="outline" className="text-xs text-destructive border-destructive/40 bg-destructive/5">
                          {missing.length} missed
                        </Badge>
                      )}
                      {late.length > 0 && (
                        <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/5">
                          {late.length} late
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 px-4 pb-3 rounded-b-lg space-y-3 pt-2">
                {allGood ? (
                  <p className="text-sm text-green-600 dark:text-green-400 py-2 flex items-center gap-2">
                    ✅ All {users.length} users submitted their sadhana!
                  </p>
                ) : (
                  <>
                    {missing.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                          <span className="text-destructive font-bold">✗</span> Missed ({missing.length})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                          {missing.map(u => (
                            <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/5 border border-destructive/15">
                              <span className="text-destructive text-xs font-bold">✗</span>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{u.fullName}</p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {u.guideName && <p className="text-[10px] text-muted-foreground truncate">{u.guideName}</p>}
                                  {u.guideName && u.residencyType && <span className="text-[10px] text-muted-foreground">·</span>}
                                  <StatusBadge type={u.residencyType} />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {late.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                          <span className="text-amber-600 dark:text-amber-400 font-bold">L</span> Late submission ({late.length})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                          {late.map(u => (
                            <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/5 border border-amber-500/20">
                              <span className="text-amber-600 dark:text-amber-400 text-xs font-bold">L</span>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{u.fullName}</p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {u.guideName && <p className="text-[10px] text-muted-foreground truncate">{u.guideName}</p>}
                                  {u.guideName && u.residencyType && <span className="text-[10px] text-muted-foreground">·</span>}
                                  <StatusBadge type={u.residencyType} />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ─── Mobile Card View ─────────────────────────────────────────────────────────

function MobileView({ data }: { data: ReportData }) {
  const { users, dates, matrix } = data;
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  if (users.length === 0) return <p className="text-center text-sm text-muted-foreground py-8">No users found.</p>;

  return (
    <div className="space-y-2">
      {users.map(u => {
        const userDates = matrix[u.id] || {};
        const missedCount = dates.filter(d => userDates[d] === 'missed').length;
        const lateCount = dates.filter(d => userDates[d] === 'late').length;
        const filledCount = dates.length - missedCount - lateCount;
        const isExpanded = expandedUser === u.id;
        const missedDates = dates.filter(d => userDates[d] === 'missed');
        const lateDates = dates.filter(d => userDates[d] === 'late');
        const hasProblem = missedCount > 0 || lateCount > 0;

        return (
          <div key={u.id} className={`rounded-lg border transition-colors ${missedCount > 0 ? 'border-destructive/30 bg-destructive/5' : lateCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card'}`}>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
              onClick={() => setExpandedUser(isExpanded ? null : u.id)}
            >
              {/* Status badge — always visible on the left */}
              <div className="shrink-0">
                {missedCount > 0 ? (
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-destructive/15 text-destructive text-sm font-bold">
                    {missedCount}
                  </span>
                ) : lateCount > 0 ? (
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-sm font-bold">
                    {lateCount}L
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-bold">
                    ✓
                  </span>
                )}
              </div>
              {/* Name + secondary details */}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-sm block truncate">{u.fullName}</span>
                <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground truncate">
                  {u.guideName && <span className="truncate max-w-[80px]">{u.guideName}</span>}
                  {u.guideName && u.residencyName && <span>·</span>}
                  {u.residencyName && <span className="truncate max-w-[80px]">{u.residencyName.replace(/^FOLK\s+/i, '')}</span>}
                  {(u.guideName || u.residencyName) && <span>·</span>}
                  <StatusBadge type={u.residencyType} />
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${(filledCount / dates.length) * 100}%` }}
                    />
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${(lateCount / dates.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{filledCount}/{dates.length}</span>
                  {lateCount > 0 && <span className="text-[11px] text-amber-600 dark:text-amber-400 shrink-0">{lateCount}L</span>}
                </div>
              </div>
              {/* Expand chevron */}
              {hasProblem && (
                <div className="shrink-0">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              )}
            </button>
            {isExpanded && hasProblem && (
              <div className="px-4 pb-3 pt-0 border-t border-border/40 space-y-2 mt-1">
                {missedDates.length > 0 && (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1 mt-2 flex items-center gap-1">
                      <span className="text-destructive font-bold">✗</span> Missed on:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {missedDates.map(d => (
                        <span key={d} className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                          {format(new Date(d + 'T00:00:00'), 'EEE, MMM d')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {lateDates.length > 0 && (
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1 flex items-center gap-1">
                      <span className="text-amber-600 dark:text-amber-400 font-bold">L</span> Late on:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {lateDates.map(d => (
                        <span key={d} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          {format(new Date(d + 'T00:00:00'), 'EEE, MMM d')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

const PERIOD_LABELS: { value: Period; label: string }[] = [
  { value: 'this-week',  label: 'This Week' },
  { value: 'last-week',  label: 'Last Week' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'custom',     label: 'Custom' },
];

interface Props { guideId: string; }

export default function MissingSadhanaTab({ guideId }: Props) {
  const [period, setPeriod] = useState<Period>('last-week');
  const [customStart, setCustomStart] = useState(() => format(subWeeks(new Date(), 2), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd]     = useState(() => format(subWeeks(new Date(), 1), 'yyyy-MM-dd'));
  const [residencyId, setResidencyId] = useState('all');
  const [view, setView] = useState<ViewMode>('matrix');
  const [hideZeroMissed, setHideZeroMissed] = useState(false);
  const [guideFilter, setGuideFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [residencies, setResidencies] = useState<{ residencyId: string; residencyName: string }[]>([]);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);

  // Default to cards on mobile
  useEffect(() => {
    if (window.innerWidth < 768) setView('cards');
  }, []);

  // Fetch residency list
  useEffect(() => {
    getAllResidencies({}).then(setResidencies).catch(() => {});
  }, []);

  const { start, end } = getDateRange(period, customStart, customEnd);

  const load = useCallback(async () => {
    if (period === 'custom' && (!customStart || !customEnd)) return;
    setLoading(true);
    try {
      const res = await getMissingSadhanaReport({
        startDate: start,
        endDate: end,
        guideId: guideId === 'ALL' ? undefined : guideId,
        residencyId: residencyId !== 'all' ? residencyId : undefined,
      });
      setData(res as ReportData);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [start, end, guideId, residencyId, period, customStart, customEnd]);

  useEffect(() => { load(); }, [load]);

  // Filtered data — client-side guide/status/hideZero filters
  const filteredData = useMemo(() => {
    if (!data) return null;
    let users = data.users;
    if (guideFilter !== 'all') users = users.filter(u => u.guideId === guideFilter);
    if (statusFilter !== 'all') users = users.filter(u => u.residencyType === statusFilter);
    if (hideZeroMissed) {
      users = users.filter(u => {
        const userDates = data.matrix[u.id] || {};
        return data.dates.some(d => userDates[d] !== 'filled');
      });
    }
    // Sort by most missed first, then most late, alphabetical tiebreaker
    users = [...users].sort((a, b) => {
      const aMissed = data.dates.filter(d => data.matrix[a.id]?.[d] === 'missed').length;
      const bMissed = data.dates.filter(d => data.matrix[b.id]?.[d] === 'missed').length;
      if (bMissed !== aMissed) return bMissed - aMissed;
      const aLate = data.dates.filter(d => data.matrix[a.id]?.[d] === 'late').length;
      const bLate = data.dates.filter(d => data.matrix[b.id]?.[d] === 'late').length;
      if (bLate !== aLate) return bLate - aLate;
      return a.fullName.localeCompare(b.fullName);
    });
    return { ...data, users };
  }, [data, guideFilter, statusFilter, hideZeroMissed]);

  const handleExport = () => {
    if (!filteredData || filteredData.users.length === 0) return;
    const headers = ['Name', 'Guide', 'Center', 'Status', ...filteredData.dates.map(d => format(new Date(d + 'T00:00:00'), 'MMM d')), 'Days Missed', 'Days Late', 'Days Filled'];
    const rows = filteredData.users.map(u => {
      const userDates = filteredData.matrix[u.id] || {};
      const missedCount = filteredData.dates.filter(d => userDates[d] === 'missed').length;
      const lateCount = filteredData.dates.filter(d => userDates[d] === 'late').length;
      return [
        u.fullName,
        u.guideName,
        u.residencyName,
        u.residencyType,
        ...filteredData.dates.map(d => {
          const s = userDates[d] || 'missed';
          return s === 'filled' ? '✓' : s === 'late' ? 'L' : '✗';
        }),
        missedCount,
        lateCount,
        filteredData.dates.length - missedCount - lateCount,
      ];
    });
    exportToCsv(`missing-sadhana-${start}-to-${end}.csv`, headers, rows as any);
    toast.success('CSV exported!');
  };

  const showResidencyFilter = guideId === 'ALL' || residencies.length > 1;
  const showGuideFilter = guideId === 'ALL' && data && data.guides.length > 1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Missing Sadhana Report</h2>
        <p className="text-sm text-muted-foreground">Track who hasn't filled their sadhana (or filled late) — by date range</p>
      </div>

      {/* Controls row 1: Period + Custom dates */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_LABELS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                period === p.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 text-xs w-36" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 text-xs w-36" />
          </div>
        )}
      </div>

      {/* Controls row 2: Filters + view toggle + export */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Server-side residency filter */}
        {showResidencyFilter && (
          <Select value={residencyId} onValueChange={setResidencyId}>
            <SelectTrigger className="h-8 text-xs w-44">
              <SelectValue placeholder="All Residencies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Residencies</SelectItem>
              {residencies.map(r => (
                <SelectItem key={r.residencyId} value={r.residencyId}>
                  {r.residencyName.replace(/^FOLK\s+/i, '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Client-side guide filter */}
        {showGuideFilter && (
          <Select value={guideFilter} onValueChange={setGuideFilter}>
            <SelectTrigger className="h-8 text-xs w-40">
              <SelectValue placeholder="All Guides" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Guides</SelectItem>
              {data!.guides.map(g => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Client-side status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Resident">Resident</SelectItem>
            <SelectItem value="Scholar">Scholar</SelectItem>
            <SelectItem value="Non-Resident">Non-Resident</SelectItem>
          </SelectContent>
        </Select>

        {/* Hide 0 missed toggle */}
        <div className="flex items-center gap-1.5">
          <Switch
            id="hide-zero"
            checked={hideZeroMissed}
            onCheckedChange={setHideZeroMissed}
            className="h-4 w-7 data-[state=checked]:bg-primary"
          />
          <Label htmlFor="hide-zero" className="text-xs text-muted-foreground cursor-pointer select-none whitespace-nowrap">
            Hide perfect
          </Label>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => setView('matrix')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${view === 'matrix' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50'}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Matrix</span>
          </button>
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-l border-border ${view === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50'}`}
          >
            <List className="w-3.5 h-3.5" /> <span className="hidden sm:inline">List</span>
          </button>
          <button
            onClick={() => setView('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-l border-border ${view === 'cards' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50'}`}
          >
            <Smartphone className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Cards</span>
          </button>
        </div>

        {/* Export */}
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleExport} disabled={!filteredData || loading}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      {/* Date range + count label */}
      {data && !loading && filteredData && (
        <p className="text-xs text-muted-foreground">
          Showing {format(new Date(start + 'T00:00:00'), 'MMM d')} – {format(new Date(end + 'T00:00:00'), 'MMM d, yyyy')}
          {' · '}{data.dates.length} days
          {' · '}
          {filteredData.users.length !== data.users.length
            ? <>{filteredData.users.length} of {data.users.length} users</>
            : <>{data.users.length} users</>
          }
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
          <Skeleton className="h-48 rounded-lg" />
        </div>
      )}

      {!loading && data && filteredData && (
        <>
          <StatsRow stats={data.stats} />
          <Legend />
          {filteredData.users.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              No users found for the selected filters.
            </div>
          ) : view === 'matrix' ? (
            <MatrixView data={filteredData} />
          ) : view === 'list' ? (
            <ListView data={filteredData} />
          ) : (
            <MobileView data={filteredData} />
          )}
        </>
      )}
    </div>
  );
}
