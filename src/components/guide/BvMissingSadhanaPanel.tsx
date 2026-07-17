import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Users, TrendingDown, Clock, AlertTriangle, Download, Search, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { format, subDays, differenceInDays, parseISO } from 'date-fns';
import { getBvMissingSadhana, updateUserStatus } from 'zite-endpoints-sdk';
import type { GetBvMissingSadhanaOutputType } from 'zite-endpoints-sdk';

type MemberRow = GetBvMissingSadhanaOutputType['members'][0];

interface Props { guideId: string; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtD = (d: Date) => d.toISOString().split('T')[0];
const today = new Date();

const fillRateColor = (rate: number) =>
  rate >= 80 ? 'text-green-600 dark:text-green-400' :
  rate >= 50 ? 'text-amber-600 dark:text-amber-400' :
  'text-destructive';

const fillRateBg = (rate: number) =>
  rate >= 80 ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20' :
  rate >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20' :
  'bg-destructive/10 text-destructive border-destructive/20';

function LastFilledCell({ date }: { date: string | null }) {
  if (!date) return <span className="text-destructive font-medium text-xs">Never</span>;
  const days = differenceInDays(today, parseISO(date));
  const label = format(parseISO(date), 'MMM d');
  if (days > 7) return <span className="text-destructive text-xs font-medium">{label}</span>;
  return <span className="text-xs text-foreground">{label}</span>;
}

// ── Stats Cards ───────────────────────────────────────────────────────────────

function StatsCards({ members }: { members: MemberRow[] }) {
  const total = members.length;
  const withGaps = members.filter(m => m.missingDays > 0).length;
  const avgFill = total > 0
    ? Math.round(members.reduce((s, m) => s + m.fillRate, 0) / total)
    : 0;
  const totalLate = members.reduce((s, m) => s + m.lateDays, 0);

  const cards = [
    { label: 'Total Members', value: total, icon: Users, sub: 'in date range' },
    { label: 'Members with Gaps', value: withGaps, icon: AlertTriangle, sub: 'missing ≥1 day', highlight: withGaps > 0 },
    { label: 'Avg Fill Rate', value: `${avgFill}%`, icon: TrendingDown, sub: 'across all members', rateVal: avgFill },
    { label: 'Total Late Fills', value: totalLate, icon: Clock, sub: 'submitted next day+', amber: totalLate > 0 },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => {
        const Icon = c.icon;
        return (
          <div key={c.label} className="rounded-xl border border-border bg-card px-4 py-3 flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-muted shrink-0 mt-0.5">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className={`text-xl font-bold leading-tight
                ${c.highlight ? 'text-destructive' : ''}
                ${c.amber ? 'text-amber-600 dark:text-amber-400' : ''}
                ${c.rateVal !== undefined ? fillRateColor(c.rateVal) : ''}
                ${!c.highlight && !c.amber && c.rateVal === undefined ? 'text-foreground' : ''}
              `}>{c.value}</p>
              <p className="text-xs text-muted-foreground leading-tight mt-0.5">{c.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Desktop Table ─────────────────────────────────────────────────────────────

function DesktopTable({
  members, deactivating, onDeactivate,
}: {
  members: MemberRow[];
  deactivating: string | null;
  onDeactivate: (m: MemberRow) => void;
}) {
  if (members.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No members match the current filters.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted text-xs text-muted-foreground">
            <th className="text-left px-4 py-2.5 font-semibold whitespace-nowrap">Member</th>
            <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap">Group</th>
            <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap hidden md:table-cell">BVSL</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Last Filled</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Missing</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap hidden sm:table-cell">Late</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Fill Rate</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap hidden sm:table-cell">Status</th>
            <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap">Action</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, idx) => (
            <tr
              key={`${m.userId}-${m.groupId}`}
              className={`border-t border-border/40 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/10'}`}
            >
              {/* Member */}
              <td className="px-4 py-2.5">
                <p className="font-medium text-sm leading-tight">{m.fullName}</p>
                {m.phone && <p className="text-xs text-muted-foreground">{m.phone}</p>}
              </td>
              {/* Group */}
              <td className="px-3 py-2.5">
                <p className="text-xs text-foreground truncate max-w-[120px]">{m.groupName || '—'}</p>
              </td>
              {/* BVSL */}
              <td className="px-3 py-2.5 hidden md:table-cell">
                <p className="text-xs text-muted-foreground truncate max-w-[100px]">{m.bvslName || '—'}</p>
              </td>
              {/* Last Filled */}
              <td className="px-3 py-2.5 text-center">
                <LastFilledCell date={m.lastFilledDate} />
              </td>
              {/* Missing */}
              <td className="px-3 py-2.5 text-center">
                <span className={`font-bold text-sm ${m.missingDays > 3 ? 'text-destructive' : m.missingDays > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                  {m.missingDays}
                </span>
              </td>
              {/* Late */}
              <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                <span className={`font-semibold text-sm ${m.lateDays > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                  {m.lateDays}
                </span>
              </td>
              {/* Fill Rate */}
              <td className="px-3 py-2.5 text-center">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${fillRateBg(m.fillRate)}`}>
                  {m.fillRate}%
                </span>
              </td>
              {/* Status */}
              <td className="px-3 py-2.5 text-center hidden sm:table-cell">
                {m.status === 'Active' ? (
                  <Badge variant="outline" className="text-xs text-green-700 dark:text-green-400 border-green-500/30 bg-green-500/10">Active</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground border-border">Inactive</Badge>
                )}
              </td>
              {/* Action */}
              <td className="px-3 py-2.5 text-center">
                {m.status === 'Active' ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2 text-destructive border-destructive/30 hover:bg-destructive/10"
                        disabled={deactivating === m.userId}
                      >
                        <UserMinus className="w-3 h-3 mr-1" />
                        {deactivating === m.userId ? '…' : 'Deactivate'}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate {m.fullName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          They will be removed from active group strength and sadhana monitoring.
                          You can re-activate them from the Users tab.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90"
                          onClick={() => onDeactivate(m)}
                        >
                          Deactivate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile Card ───────────────────────────────────────────────────────────────

function MobileCard({
  member, deactivating, onDeactivate,
}: {
  member: MemberRow;
  deactivating: string | null;
  onDeactivate: (m: MemberRow) => void;
}) {
  const borderClass = member.missingDays > 3
    ? 'border-destructive/30 bg-destructive/5'
    : member.missingDays > 0 || member.lateDays > 0
      ? 'border-amber-500/30 bg-amber-500/5'
      : 'border-border bg-card';

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${borderClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm leading-tight">{member.fullName}</p>
          {member.phone && <p className="text-xs text-muted-foreground">{member.phone}</p>}
          <p className="text-xs text-muted-foreground mt-0.5">{member.groupName}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${fillRateBg(member.fillRate)}`}>
            {member.fillRate}%
          </span>
          {member.status === 'Active' ? (
            <Badge variant="outline" className="text-xs text-green-700 dark:text-green-400 border-green-500/30 bg-green-500/10">Active</Badge>
          ) : (
            <Badge variant="outline" className="text-xs text-muted-foreground border-border">Inactive</Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className="text-muted-foreground">Last filled: <LastFilledCell date={member.lastFilledDate} /></span>
        <span className={`font-semibold ${member.missingDays > 3 ? 'text-destructive' : member.missingDays > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
          {member.missingDays} missing
        </span>
        {member.lateDays > 0 && (
          <span className="text-amber-600 dark:text-amber-400 font-semibold">{member.lateDays} late</span>
        )}
      </div>
      {member.status === 'Active' && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={deactivating === member.userId}
            >
              <UserMinus className="w-3 h-3 mr-1" />
              {deactivating === member.userId ? 'Deactivating…' : 'Deactivate Member'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate {member.fullName}?</AlertDialogTitle>
              <AlertDialogDescription>
                They will be removed from active group strength and sadhana monitoring.
                You can re-activate them from the Users tab.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => onDeactivate(member)}
              >
                Deactivate
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BvMissingSadhanaPanel({ guideId }: Props) {
  const [startDate, setStartDate] = useState(() => fmtD(subDays(today, 6)));
  const [endDate, setEndDate] = useState(() => fmtD(today));
  const [groupFilter, setGroupFilter] = useState('all');
  const [bvslFilter, setBvslFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'inactive'>('active');
  const [minMissing, setMinMissing] = useState('');
  const [minLate, setMinLate] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<GetBvMissingSadhanaOutputType | null>(null);
  const [loading, setLoading] = useState(false);
  const [deactivating, setDeactivating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) return;
    setLoading(true);
    try {
      const res = await getBvMissingSadhana({ guideId, startDate, endDate });
      setData(res as GetBvMissingSadhanaOutputType);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load missing sadhana data');
    } finally {
      setLoading(false);
    }
  }, [guideId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const filteredMembers = useMemo(() => {
    if (!data) return [];
    let m = data.members;
    if (groupFilter !== 'all') m = m.filter(x => x.groupId === groupFilter);
    if (bvslFilter !== 'all') m = m.filter(x => x.bvslId === bvslFilter);
    if (statusFilter === 'active') m = m.filter(x => x.status === 'Active');
    else if (statusFilter === 'inactive') m = m.filter(x => x.status !== 'Active');
    const minM = parseInt(minMissing, 10);
    if (!isNaN(minM) && minM > 0) m = m.filter(x => x.missingDays >= minM);
    const minL = parseInt(minLate, 10);
    if (!isNaN(minL) && minL > 0) m = m.filter(x => x.lateDays >= minL);
    if (search.trim()) m = m.filter(x => x.fullName.toLowerCase().includes(search.toLowerCase().trim()));
    return [...m].sort((a, b) => b.missingDays - a.missingDays || b.lateDays - a.lateDays || a.fullName.localeCompare(b.fullName));
  }, [data, groupFilter, bvslFilter, statusFilter, minMissing, minLate, search]);

  const handleDeactivate = async (member: MemberRow) => {
    setDeactivating(member.userId);
    try {
      await updateUserStatus({ userId: member.userId, status: 'Inactive' });
      toast.success(`${member.fullName} has been deactivated`);
      load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to deactivate member');
    } finally {
      setDeactivating(null);
    }
  };

  const handleExportCsv = () => {
    if (!filteredMembers.length) return;
    const headers = ['Member Name', 'Phone', 'Group', 'BVSL', 'Status', 'Last Filled', 'Missing Days', 'Late Days', 'Total Days', 'Fill Rate'];
    const rows = filteredMembers.map(m => [
      m.fullName,
      m.phone,
      m.groupName,
      m.bvslName,
      m.status,
      m.lastFilledDate || 'Never',
      m.missingDays,
      m.lateDays,
      m.totalDays,
      `${m.fillRate}%`,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bv-missing-sadhana-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-bold">Missing Sadhana Tracker</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Track BV group members with gaps, late fills, or low fill rates across a date range</p>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Date range + search row */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1.5">
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-xs w-36" />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-8 text-xs w-36" />
          </div>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search member name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 ml-auto" onClick={handleExportCsv} disabled={loading || !filteredMembers.length}>
            <Download className="w-3.5 h-3.5" />Export CSV
          </Button>
        </div>

        {/* Second row: dropdowns + status toggle + min filters */}
        <div className="flex flex-wrap gap-2 items-center">
          {data && data.groups.length > 1 && (
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="h-8 text-xs w-40">
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                {data.groups.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {data && data.bvsls.length > 1 && (
            <Select value={bvslFilter} onValueChange={setBvslFilter}>
              <SelectTrigger className="h-8 text-xs w-40">
                <SelectValue placeholder="All BVSLs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All BVSLs</SelectItem>
                {data.bvsls.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Status toggle */}
          <div className="flex items-center border border-border rounded-md overflow-hidden text-xs">
            {(['active', 'all', 'inactive'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 capitalize transition-colors border-r last:border-r-0 border-border ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50'}`}
              >
                {s === 'active' ? 'Active Only' : s === 'inactive' ? 'Inactive Only' : 'All'}
              </button>
            ))}
          </div>

          {/* Min missing days */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Min missing:</span>
            <Input
              type="number"
              min={0}
              value={minMissing}
              onChange={e => setMinMissing(e.target.value)}
              className="h-8 text-xs w-16"
              placeholder="0"
            />
          </div>

          {/* Min late days */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Min late:</span>
            <Input
              type="number"
              min={0}
              value={minLate}
              onChange={e => setMinLate(e.target.value)}
              className="h-8 text-xs w-16"
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Range label */}
      {!loading && data && (
        <p className="text-xs text-muted-foreground">
          {format(parseISO(startDate), 'MMM d')} – {format(parseISO(endDate), 'MMM d, yyyy')}
          {' · '}{data.members.length > 0 ? data.members[0].totalDays : 0} days
          {' · '}{filteredMembers.length !== data.members.length
            ? `${filteredMembers.length} of ${data.members.length} members`
            : `${filteredMembers.length} members`}
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
          <Skeleton className="h-48 rounded-lg" />
        </div>
      )}

      {/* Content */}
      {!loading && data && (
        <>
          <StatsCards members={filteredMembers} />

          {/* Desktop table */}
          <div className="hidden sm:block">
            <DesktopTable
              members={filteredMembers}
              deactivating={deactivating}
              onDeactivate={handleDeactivate}
            />
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {filteredMembers.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No members match the current filters.</p>
              </div>
            ) : (
              filteredMembers.map(m => (
                <MobileCard
                  key={`${m.userId}-${m.groupId}`}
                  member={m}
                  deactivating={deactivating}
                  onDeactivate={handleDeactivate}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
