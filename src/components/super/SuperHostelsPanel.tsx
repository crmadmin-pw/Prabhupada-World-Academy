import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { createResidency, assignFolkResidencyGuides, getAllResidenciesWithStats, getGuides as fetchGuides } from '@/lib/endpoints-sdk';
import type { GetAllResidenciesWithStatsOutputType, GetGuidesOutputType } from '@/lib/endpoints-sdk';

type Residency = GetAllResidenciesWithStatsOutputType[0];
type GuideEntry = { guideId: string; guideName: string; abbreviation: string; recordId: string; residentCount: number };

function assignedGuideIds(r: Residency): string[] {
  const explicit = (r as any).assignedGuideIds;
  if (Array.isArray(explicit)) return explicit.map(String);
  return getGuideEntries(r).map(g => String(g.recordId || g.guideId)).filter(Boolean);
}

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const v = Math.round(value * 100) / 100;
  const cls = v >= 80 ? 'text-green-600 font-semibold' : v >= 60 ? 'text-amber-600 font-semibold' : 'text-red-500 font-semibold';
  return <span className={cls}>{v}%</span>;
}

function getGuideEntries(r: Residency): GuideEntry[] {
  return ((r as any).guides as GuideEntry[] | undefined) ?? [];
}

function GuideAssignmentControl({ residency, guides, onSaved }: {
  residency: Residency;
  guides: GetGuidesOutputType['guides'];
  onSaved: (guideIds: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => assignedGuideIds(residency));
  const [saving, setSaving] = useState(false);

  useEffect(() => setSelected(assignedGuideIds(residency)), [residency]);

  const toggle = (guideId: string) => {
    setSelected(current => current.includes(guideId)
      ? current.filter(id => id !== guideId)
      : [...current, guideId]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSaved(selected);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to assign guides');
    } finally {
      setSaving(false);
    }
  };

  const labels = selected.map(id => {
    const fromGuideList = guides.find((g: any) => g.guideId === id);
    const fromResidency = getGuideEntries(residency).find((g: any) => g.recordId === id || g.guideId === id);
    return fromGuideList?.name || fromResidency?.guideName || fromResidency?.abbreviation || '';
  }).filter(Boolean);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="w-full min-w-[190px] rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-sm hover:bg-muted/40">
        <span className={labels.length ? 'text-foreground' : 'text-muted-foreground'}>
          {labels.length ? labels.join(', ') : 'Assign guides'}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">Assign FOLK guides to {residency.residencyName}</div>
        <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
          {guides.map((g: any) => (
            <label key={g.guideId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60">
              <Checkbox checked={selected.includes(g.guideId)} onCheckedChange={() => toggle(g.guideId)} />
              <span className="truncate">{g.name}</span>
            </label>
          ))}
          {guides.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No active FOLK guides found.</div>}
        </div>
        <button type="button" className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save assignments'}
        </button>
      </PopoverContent>
    </Popover>
  );
}

export default function SuperHostelsPanel() {
  const [residencies, setResidencies] = useState<Residency[]>([]);
  const [guidesList, setGuidesList] = useState<GetGuidesOutputType['guides']>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [guideFilter, setGuideFilter] = useState('All');
  const [newHostel, setNewHostel] = useState('');
  const [creating, setCreating] = useState(false);
  const addHostel = async () => {
    if (!newHostel.trim()) return;
    setCreating(true);
    try {
      await createResidency({ residencyName: newHostel.trim() });
      setNewHostel('');
      await reload();
      toast.success('FOLK hostel created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create hostel');
    } finally { setCreating(false); }
  };

  const reload = useReactiveLoader(async (read) => {
    const [res, gs] = await Promise.all([
      read(() => getAllResidenciesWithStats({ _nocache: true } as any)),
      read(() => fetchGuides({ segment: 'FOLK', _nocache: true } as any)).then(r => r.guides).catch(() => [] as GetGuidesOutputType['guides']),
    ]);
    !read.cancelled && setResidencies(res);
    !read.cancelled && setGuidesList(gs);
  }, []);

  useEffect(() => {
    reload()
      .catch(() => toast.error('Failed to load hostels'))
      .finally(() => setLoading(false));
  }, [reload]);

  const filtered = useMemo(() => residencies.filter(r => {
    // Guide filter: match if any of the residency's guides matches
    if (guideFilter !== 'All') {
      const guides = getGuideEntries(r);
      const matchesGuide = assignedGuideIds(r).some(id => id === guideFilter) ||
        guides.some(g => g.guideId === guideFilter) || (r as any).guideId === guideFilter;
      if (!matchesGuide) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const nameMatch = r.residencyName.toLowerCase().includes(q);
      const guides = getGuideEntries(r);
      const guideMatch = guides.length > 0
        ? guides.some((g: any) => g.guideName.toLowerCase().includes(q) || (g.abbreviation || '').toLowerCase().includes(q))
        : (r as any).guideName?.toLowerCase().includes(q);
      if (!nameMatch && !guideMatch) return false;
    }
    return true;
  }), [residencies, guideFilter, search]);

  const monthLabels = residencies[0]?.monthlyAvgs?.map((m: any) => m.month) ?? [];

  // Summary computed from filtered array (respects search/guide filter)
  const summary = useMemo(() => {
    const activeCount = filtered.filter(r => r.isActive).length;
    const totalBoys = filtered.reduce((s, r) => s + (r.residentCount || 0), 0);

    const monthSummaries = monthLabels.map((month: string) => {
      let weightedSum = 0, totalWeight = 0;
      filtered.forEach(r => {
        const m = r.monthlyAvgs.find((mv: any) => mv.month === month);
        if (m && m.avg != null && r.residentCount > 0) {
          weightedSum += m.avg * r.residentCount;
          totalWeight += r.residentCount;
        }
      });
      return { month, avg: totalWeight > 0 ? weightedSum / totalWeight : null };
    });

    let qSum = 0, qWeight = 0;
    filtered.forEach(r => {
      if (r.quarterAvg != null && r.residentCount > 0) {
        qSum += r.quarterAvg * r.residentCount;
        qWeight += r.residentCount;
      }
    });
    const quarterAvg = qWeight > 0 ? qSum / qWeight : null;

    return { activeCount, totalBoys, monthSummaries, quarterAvg };
  }, [filtered, monthLabels]);

  // Columns: Name + Guides + Residents + months + Quarter Avg
  const totalCols = 3 + monthLabels.length + 1;

  const saveAssignments = async (residency: Residency, guideIds: string[]) => {
    await assignFolkResidencyGuides({ residencyId: residency.residencyId, guideIds } as any);
    await reload();
    toast.success(`Guides assigned to ${residency.residencyName}`);
  };

  if (loading) return <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">FOLK Hostels ({filtered.length})</CardTitle>
        <form className="flex gap-2 mt-2" onSubmit={event => { event.preventDefault(); void addHostel(); }}>
          <Input aria-label="New FOLK hostel name" placeholder="New FOLK hostel name" maxLength={100} value={newHostel} onChange={event => setNewHostel(event.target.value)} />
          <button type="submit" disabled={creating || !newHostel.trim()} className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{creating ? 'Creating…' : 'Create hostel'}</button>
        </form>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search hostel, guide, abbreviation..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={guideFilter} onValueChange={(value) => setGuideFilter(value || 'All')}>
            <SelectTrigger className="h-9 w-48 shrink-0">
              <SelectValue>
                {guideFilter === 'All' ? 'All Guides' : (guidesList.find((g: any) => g.guideId === guideFilter)?.name || guideFilter)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Guides</SelectItem>
              {guidesList.map((g: any) => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="min-w-[180px]">Hostel Name</TableHead>
                <TableHead className="min-w-[180px]">Guides (Residents)</TableHead>
                <TableHead className="text-center min-w-[80px]">Total</TableHead>
                {monthLabels.map((m: string) => (
                  <TableHead key={m} className="text-center min-w-[80px]">{m} Avg</TableHead>
                ))}
                <TableHead className="text-center min-w-[90px] font-bold">Quarter Avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.residencyId} className={!r.isActive ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{r.residencyName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <GuideAssignmentControl residency={r} guides={guidesList} onSaved={ids => saveAssignments(r, ids)} />
                  </TableCell>
                  <TableCell className="text-center text-sm font-semibold text-primary">{r.residentCount}</TableCell>
                {r.monthlyAvgs.map((m: any) => (
                    <TableCell key={m.month} className="text-center"><ScoreCell value={m.avg} /></TableCell>
                  ))}
                  <TableCell className="text-center">
                    <ScoreCell value={r.quarterAvg} />
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={totalCols} className="text-center py-8 text-muted-foreground">No hostels found</TableCell>
                </TableRow>
              )}
              {/* Summary footer row */}
              {filtered.length > 0 && (
                <TableRow className="bg-muted/70 border-t-2 border-border">
                  <TableCell className="font-bold text-sm">
                    Summary
                    <span className="block text-xs font-normal text-muted-foreground">{summary.activeCount} active hostel{summary.activeCount !== 1 ? 's' : ''}</span>
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-center font-bold text-sm text-primary">{summary.totalBoys}</TableCell>
                  {summary.monthSummaries.map((m: { month: string; avg: number | null }) => (
                    <TableCell key={m.month} className="text-center font-bold">
                      <ScoreCell value={m.avg} />
                    </TableCell>
                  ))}
                  <TableCell className="text-center font-bold">
                    <ScoreCell value={summary.quarterAvg} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
