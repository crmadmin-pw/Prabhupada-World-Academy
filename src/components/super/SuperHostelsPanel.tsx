import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { getAllResidenciesWithStats, getGuides as fetchGuides } from 'zite-endpoints-sdk';
import type { GetAllResidenciesWithStatsOutputType, GetGuidesOutputType } from 'zite-endpoints-sdk';

type Residency = GetAllResidenciesWithStatsOutputType[0];
type GuideEntry = { guideId: string; guideName: string; abbreviation: string; recordId: string; residentCount: number };

function ScoreCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground text-xs">—</span>;
  const v = Math.round(value * 100) / 100;
  const cls = v >= 80 ? 'text-green-600 font-semibold' : v >= 60 ? 'text-amber-600 font-semibold' : 'text-red-500 font-semibold';
  return <span className={cls}>{v}%</span>;
}

function getGuideEntries(r: Residency): GuideEntry[] {
  return ((r as any).guides as GuideEntry[] | undefined) ?? [];
}

// Display guide abbreviations with per-guide resident counts: "SPD (5), MKD (3)"
function getGuideLabel(r: Residency): string {
  const guides = getGuideEntries(r);
  if (guides.length > 0) {
    return guides.map(g => {
      const label = g.abbreviation || g.guideName;
      return g.residentCount > 0 ? `${label} (${g.residentCount})` : label;
    }).filter(Boolean).join(', ');
  }
  return (r as any).guideName || '—';
}

export default function SuperHostelsPanel() {
  const [residencies, setResidencies] = useState<Residency[]>([]);
  const [guidesList, setGuidesList] = useState<GetGuidesOutputType['guides']>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [guideFilter, setGuideFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      getAllResidenciesWithStats({}),
      fetchGuides({}).then(r => r.guides).catch(() => [] as GetGuidesOutputType['guides']),
    ])
      .then(([res, gs]) => { setResidencies(res); setGuidesList(gs); })
      .catch(() => toast.error('Failed to load hostels'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => residencies.filter(r => {
    // Guide filter: match if any of the residency's guides matches
    if (guideFilter !== 'all') {
      const guides = getGuideEntries(r);
      const matchesGuide = guides.length > 0
        ? guides.some(g => g.guideId === guideFilter)
        : (r as any).guideId === guideFilter;
      if (!matchesGuide) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const nameMatch = r.residencyName.toLowerCase().includes(q);
      const guides = getGuideEntries(r);
      const guideMatch = guides.length > 0
        ? guides.some(g => g.guideName.toLowerCase().includes(q) || (g.abbreviation || '').toLowerCase().includes(q))
        : (r as any).guideName?.toLowerCase().includes(q);
      if (!nameMatch && !guideMatch) return false;
    }
    return true;
  }), [residencies, guideFilter, search]);

  const monthLabels = residencies[0]?.monthlyAvgs?.map(m => m.month) ?? [];

  // Summary computed from filtered array (respects search/guide filter)
  const summary = useMemo(() => {
    const activeCount = filtered.filter(r => r.isActive).length;
    const totalBoys = filtered.reduce((s, r) => s + (r.residentCount || 0), 0);

    const monthSummaries = monthLabels.map(month => {
      let weightedSum = 0, totalWeight = 0;
      filtered.forEach(r => {
        const m = r.monthlyAvgs.find(mv => mv.month === month);
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

  if (loading) return <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">FOLK Hostels ({filtered.length})</CardTitle>
        <div className="flex flex-col sm:flex-row gap-3 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search hostel, guide, abbreviation..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={guideFilter} onValueChange={setGuideFilter}>
            <SelectTrigger className="h-9 w-48 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Guides</SelectItem>
              {guidesList.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
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
                {monthLabels.map(m => (
                  <TableHead key={m} className="text-center min-w-[80px]">{m} Avg</TableHead>
                ))}
                <TableHead className="text-center min-w-[90px] font-bold">Quarter Avg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => (
                <TableRow key={r.residencyId} className={!r.isActive ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{r.residencyName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{getGuideLabel(r)}</TableCell>
                  <TableCell className="text-center text-sm font-semibold text-primary">{r.residentCount}</TableCell>
                  {r.monthlyAvgs.map(m => (
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
                  {summary.monthSummaries.map(m => (
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
