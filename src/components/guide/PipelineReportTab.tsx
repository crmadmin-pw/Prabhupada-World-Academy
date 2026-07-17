import { useEffect, useState, useMemo } from 'react';
import { getPipelineReport } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { CheckSquare, Search } from 'lucide-react';

interface MonthData {
  chanting: number | null;
  reading: number | null;
  hearing: number | null;
  oneOnOnes: number | null;
  booksDistributed: number | null;
  preachingHrs: number | null;
  meetings: number | null;
}

interface Member {
  id: string;
  fullName: string;
  phone: string;
  isB: boolean;
  ashrayLevel: string | null;
  guideName: string;
  monthlyData: Record<string, MonthData>;
}

interface Section {
  level: string;
  levelNumber: number;
  members: Member[];
}

interface ReportData {
  months: string[];
  sections: Section[];
}

interface Props {
  guideId?: string;
}

const SUB_COLS = ['Chant', 'Read', 'Hear', '1-on-1', 'Books', 'Preach(h)', 'Mtgs'] as const;
const STICKY_DEFS = [
  { label: '#',     left: 0,   width: 28,  cls: 'text-center' },
  { label: 'Name',  left: 28,  width: 150, cls: 'text-left' },
  { label: 'Phone', left: 178, width: 100, cls: 'text-left' },
  { label: 'B?',    left: 278, width: 30,  cls: 'text-center' },
  { label: 'Guide', left: 308, width: 96,  cls: 'text-left' },
];

function formatMonth(key: string): string {
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function fmtNum(val: number | null | undefined): string {
  if (val == null || val === 0) return '—';
  return String(val);
}

type SortMode = 'name' | 'chanting-desc' | 'level';

function sortMembers(members: Member[], mode: SortMode, latestMonth: string): Member[] {
  const sorted = [...members];
  switch (mode) {
    case 'name':
      sorted.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      break;
    case 'chanting-desc':
      sorted.sort((a, b) => (b.monthlyData?.[latestMonth]?.chanting ?? -1) - (a.monthlyData?.[latestMonth]?.chanting ?? -1));
      break;
    case 'level':
      // default order (already sorted by level)
      break;
  }
  return sorted;
}

function SectionTable({ section, months, search, sortMode }: {
  section: Section; months: string[]; search: string; sortMode: SortMode;
}) {
  const latestMonth = months[months.length - 1] || '';
  const filtered = useMemo(() => {
    let members = section.members;
    if (search) {
      const q = search.toLowerCase();
      members = members.filter(m => m.fullName.toLowerCase().includes(q));
    }
    return sortMembers(members, sortMode, latestMonth);
  }, [section.members, search, sortMode, latestMonth]);

  if (filtered.length === 0) return null;

  return (
    <Card className="overflow-hidden border-border">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
        <span className="font-semibold text-sm">{section.level || 'No Level'}</span>
        <Badge variant="secondary" className="text-xs">{filtered.length} members</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-max min-w-full text-xs border-collapse">
          <thead>
            <tr className="bg-muted/60">
              {STICKY_DEFS.map(col => (
                <th
                  key={col.label}
                  rowSpan={2}
                  className={`sticky z-30 bg-muted px-1.5 py-1.5 font-medium border-r border-b border-border whitespace-nowrap ${col.cls}`}
                  style={{ left: col.left, minWidth: col.width }}
                >
                  {col.label}
                </th>
              ))}
              {months.map(month => (
                <th
                  key={month}
                  colSpan={7}
                  className="px-2 py-1.5 text-center font-semibold border-r border-b border-border bg-muted/50 whitespace-nowrap"
                >
                  {formatMonth(month)}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/40">
              {months.flatMap(month =>
                SUB_COLS.map(col => (
                  <th
                    key={`${month}-${col}`}
                    className="px-1.5 py-1 text-right font-medium border-r border-b border-border whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((member, idx) => (
              <tr key={member.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                <td className="sticky z-20 bg-card px-1.5 py-1.5 text-muted-foreground border-r border-border text-center" style={{ left: 0 }}>
                  {idx + 1}
                </td>
                <td className="sticky z-20 bg-card px-1.5 py-1.5 font-medium border-r border-border whitespace-nowrap" style={{ left: 28, maxWidth: 150 }}>
                  <span className="block truncate" style={{ maxWidth: 146 }}>{member.fullName}</span>
                </td>
                <td className="sticky z-20 bg-card px-1.5 py-1.5 text-muted-foreground border-r border-border whitespace-nowrap font-mono" style={{ left: 178 }}>
                  {member.phone || '—'}
                </td>
                <td className="sticky z-20 bg-card px-1.5 py-1.5 text-center border-r border-border" style={{ left: 278 }}>
                  {member.isB && <CheckSquare className="w-3 h-3 text-primary inline-block" />}
                </td>
                <td className="sticky z-20 bg-card px-1.5 py-1.5 border-r border-border whitespace-nowrap" style={{ left: 308, maxWidth: 96 }}>
                  <span className="block truncate" style={{ maxWidth: 92 }}>{member.guideName || '—'}</span>
                </td>
                {months.flatMap(month => {
                  const d: MonthData = member.monthlyData?.[month] ?? {
                    chanting: null, reading: null, hearing: null,
                    oneOnOnes: null, booksDistributed: null, preachingHrs: null, meetings: null,
                  };
                  const chantGreen = d.chanting != null && d.chanting >= 16;
                  return [
                    <td key={`${month}-ch`} className={`px-1.5 py-1.5 text-right border-r border-border font-mono ${chantGreen ? 'bg-green-500/15 text-green-700 dark:text-green-400 font-semibold' : ''}`}>
                      {fmtNum(d.chanting)}
                    </td>,
                    <td key={`${month}-rd`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.reading)}</td>,
                    <td key={`${month}-hr`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.hearing)}</td>,
                    <td key={`${month}-oo`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.oneOnOnes)}</td>,
                    <td key={`${month}-bk`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.booksDistributed)}</td>,
                    <td key={`${month}-pr`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.preachingHrs)}</td>,
                    <td key={`${month}-mt`} className="px-1.5 py-1.5 text-right border-r border-border font-mono">{fmtNum(d.meetings)}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function PipelineReportTab({ guideId }: Props) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [bOnly, setBOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('level');

  useEffect(() => {
    setLoading(true);
    setError(null);
    getPipelineReport({ guideId })
      .then(res => setData(res as ReportData))
      .catch(e => setError(e?.message || 'Failed to load pipeline data'))
      .finally(() => setLoading(false));
  }, [guideId]);

  // Gather all unique ashray levels
  const allLevels = useMemo(() => {
    if (!data) return [];
    const levels = new Set<string>();
    data.sections.forEach(s => { if (s.level) levels.add(s.level); });
    return Array.from(levels).sort();
  }, [data]);

  // Filter sections
  const filteredSections = useMemo(() => {
    if (!data) return [];
    let sections = data.sections;
    if (levelFilter !== 'all') {
      sections = sections.filter(s => s.level === levelFilter);
    }
    if (bOnly) {
      sections = sections.map(s => ({
        ...s,
        members: s.members.filter(m => m.isB),
      })).filter(s => s.members.length > 0);
    }
    return sections;
  }, [data, levelFilter, bOnly]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i} className="overflow-hidden">
            <div className="p-3 bg-muted/30 border-b border-border">
              <Skeleton className="h-5 w-40" />
            </div>
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              {[1, 2, 3, 4].map(j => <Skeleton key={j} className="h-6 w-full" />)}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-destructive text-sm">{error}</div>;
  }

  if (!data || data.sections.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No active users found for this guide's scope.
      </div>
    );
  }

  const totalFiltered = filteredSections.reduce((s, sec) => {
    const q = search.toLowerCase();
    const count = q ? sec.members.filter(m => m.fullName.toLowerCase().includes(q)).length : sec.members.length;
    return s + count;
  }, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Pipeline Report</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monthly sadhana & preaching metrics · {data.months.map(formatMonth).join(', ')}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/40 inline-block" />
            Chanting ≥ 16 rounds
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 bg-card border rounded-lg p-2.5">
        <div className="relative flex-1 min-w-[160px] max-w-[260px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v || 'all')}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Ashraya Level">
              {levelFilter === 'all' ? 'All Levels' : levelFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            {allLevels.map(l => (
              <SelectItem key={l} value={l}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortMode} onValueChange={v => setSortMode(v as SortMode)}>
          <SelectTrigger className="h-8 w-[150px] text-xs">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="level">Sort: Ashraya Level</SelectItem>
            <SelectItem value="name">Sort: Name A→Z</SelectItem>
            <SelectItem value="chanting-desc">Sort: Chanting ↓</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
          <Checkbox checked={bOnly} onCheckedChange={v => setBOnly(!!v)} className="h-3.5 w-3.5" />
          B only
        </label>
        <span className="text-xs text-muted-foreground ml-auto">{totalFiltered} members</span>
      </div>

      {filteredSections.map(section => (
        <SectionTable key={section.level || '_none'} section={section} months={data.months} search={search} sortMode={sortMode} />
      ))}

      {filteredSections.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No members match the current filters.
        </div>
      )}
    </div>
  );
}
