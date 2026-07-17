import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Minus, ArrowUpDown } from 'lucide-react';
import { scoreColor } from '@/lib/scoring';

interface UserSummary {
  userId: string; fullName: string; ashrayLevel: string | null; isResident: boolean;
  residencyName: string | null;
  submittedCount: number; totalDays: number; avgScorePercent: number;
  trend: 'up' | 'down' | 'flat';
}

const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'flat' }) => {
  if (trend === 'up') return <ArrowUp className="w-3.5 h-3.5 text-green-600" />;
  if (trend === 'down') return <ArrowDown className="w-3.5 h-3.5 text-destructive" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
};

type SortKey = 'fullName' | 'avgScorePercent' | 'submittedCount';

export default function StatsUserTable({ users }: { users: UserSummary[] }) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>('avgScorePercent');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...users].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'fullName') cmp = a.fullName.localeCompare(b.fullName);
    else if (sortKey === 'avgScorePercent') cmp = a.avgScorePercent - b.avgScorePercent;
    else if (sortKey === 'submittedCount') cmp = a.submittedCount - b.submittedCount;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortHeader = ({ col, label }: { col: SortKey; label: string }) => (
    <button
      className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      onClick={() => toggleSort(col)}
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortKey === col ? 'text-primary' : ''}`} />
    </button>
  );

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="w-8 text-xs">#</TableHead>
            <TableHead><SortHeader col="fullName" label="Name" /></TableHead>
            <TableHead className="hidden sm:table-cell text-xs text-muted-foreground uppercase tracking-wide font-medium">Ashraya</TableHead>
            <TableHead className="hidden md:table-cell text-xs text-muted-foreground uppercase tracking-wide font-medium">Residency</TableHead>
            <TableHead><SortHeader col="submittedCount" label="Submitted" /></TableHead>
            <TableHead><SortHeader col="avgScorePercent" label="Avg Score" /></TableHead>
            <TableHead className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((u, i) => (
            <TableRow
              key={u.userId}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(`/guide/users/${u.userId}`)}
            >
              <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium text-sm">{u.fullName}</TableCell>
              <TableCell className="hidden sm:table-cell">
                {u.ashrayLevel ? (
                  <Badge variant="outline" className="text-xs">{u.ashrayLevel}</Badge>
                ) : <span className="text-muted-foreground text-xs">—</span>}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {u.isResident ? (
                  <Badge variant="default" className="text-xs max-w-[120px] truncate block">
                    {u.residencyName || 'Resident'}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">NR</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm">
                <span className="font-medium">{u.submittedCount}</span>
                <span className="text-muted-foreground text-xs">/{u.totalDays}d</span>
              </TableCell>
              <TableCell>
                <span className={`font-bold text-sm ${scoreColor(u.avgScorePercent, u.isResident)}`}>
                  {u.avgScorePercent > 0 ? `${u.avgScorePercent}%` : '—'}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <TrendIcon trend={u.trend} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No user data for this period</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
