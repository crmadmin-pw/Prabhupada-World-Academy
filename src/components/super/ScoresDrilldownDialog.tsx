import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Users, Search, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { getScoresDrilldown } from 'zite-endpoints-sdk';

interface RecordItem { id: string; primary: string; secondary: string; detail: string; date: string; badges: string[]; extra?: Record<string, any> }
interface VolItem { id: string; name: string; points: number; count: number }

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  metric: string;
  entityId: string;
  entityType: 'center' | 'team' | 'individual';
  weekStart: string;
  weekEnd: string;
}

export default function ScoresDrilldownDialog({ open, onClose, title, metric, entityId, entityType, weekStart, weekEnd }: Props) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [volunteers, setVolunteers] = useState<VolItem[]>([]);
  const [search, setSearch] = useState('');
  const [drillVolId, setDrillVolId] = useState<string | null>(null);
  const [drillVolName, setDrillVolName] = useState('');
  const [level2Records, setLevel2Records] = useState<RecordItem[]>([]);
  const [level2Loading, setLevel2Loading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setRecords([]);
    setVolunteers([]);
    setSearch('');
    setDrillVolId(null);

    const params: any = { metric, weekStart, weekEnd };
    if (entityType === 'individual') params.volunteerId = entityId;
    else if (entityType === 'team') params.teamId = entityId;
    else params.centerId = entityId;

    getScoresDrilldown(params)
      .then((res: any) => {
        setRecords(res.records || []);
        setVolunteers(res.volunteers || []);
      })
      .catch(() => toast.error('Failed to load details'))
      .finally(() => setLoading(false));
  }, [open, metric, entityId, entityType, weekStart, weekEnd]);

  const loadVolRecords = (volId: string, volName: string) => {
    setDrillVolId(volId);
    setDrillVolName(volName);
    setLevel2Loading(true);
    setLevel2Records([]);
    setSearch('');
    getScoresDrilldown({ metric, volunteerId: volId, weekStart, weekEnd })
      .then((res: any) => setLevel2Records(res.records || []))
      .catch(() => toast.error('Failed to load records'))
      .finally(() => setLevel2Loading(false));
  };

  const showingLevel2 = drillVolId !== null;
  const currentRecords = showingLevel2 ? level2Records : records;
  const currentLoading = showingLevel2 ? level2Loading : loading;

  const allItems = showingLevel2 ? currentRecords : (entityType !== 'individual' && volunteers.length > 0 ? volunteers : currentRecords);
  const filtered = search
    ? allItems.filter((r: any) =>
        `${r.primary || r.name || ''} ${r.secondary || ''} ${r.detail || ''} ${JSON.stringify(r.extra || {})}`.toLowerCase().includes(search.toLowerCase()))
    : allItems;

  const showVolunteerList = !showingLevel2 && entityType !== 'individual' && volunteers.length > 0;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold leading-snug pr-6 flex items-center gap-2">
            {showingLevel2 && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setDrillVolId(null); setSearch(''); }}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            {showingLevel2 ? `${drillVolName} — ${metric}` : title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {currentLoading ? 'Loading…' : showVolunteerList
              ? `${volunteers.length} volunteers`
              : `${currentRecords.length} records`}
          </DialogDescription>
        </DialogHeader>

        {!currentLoading && (allItems as any[]).length > 5 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Search…" className="h-8 pl-9 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        )}

        <div className="overflow-y-auto flex-1 min-h-0 -mx-6 px-6">
          {currentLoading ? (
            <div className="space-y-2 py-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : showVolunteerList ? (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-background z-10">
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground w-8">#</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">Volunteer</th>
                  <th className="text-right py-2.5 px-2 font-medium text-muted-foreground">Points</th>
                  <th className="text-right py-2.5 px-2 font-medium text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as VolItem[]).map((v, i) => (
                  <tr key={v.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => loadVolRecords(v.id, v.name)}>
                    <td className="py-2 px-2 text-muted-foreground">
                      {i < 3 ? <span className="text-sm">{['🥇','🥈','🥉'][i]}</span> : i + 1}
                    </td>
                    <td className="py-2 px-2 font-medium text-primary underline underline-offset-2">{v.name}</td>
                    <td className="py-2 px-2 text-right font-mono">{v.points > 0 ? v.points.toFixed(1) : '—'}</td>
                    <td className="py-2 px-2 text-right font-mono">{v.count || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (filtered as RecordItem[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-2 text-muted-foreground">
              <Users className="w-8 h-8 opacity-30" />
              <p className="text-sm">No records found</p>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border sticky top-0 bg-background z-10">
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground w-8">#</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">Details</th>
                  <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody>
                {(filtered as RecordItem[]).map((r, i) => (
                  <tr key={`${r.id}-${i}`} className="border-b border-border/40 hover:bg-muted/20 transition-colors align-top">
                    <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2">
                      <div className="font-medium">{r.primary}</div>
                      {r.secondary && <div className="text-muted-foreground font-mono text-[10px]">{r.secondary}</div>}
                      <ExtraPills extra={r.extra} />
                    </td>
                    <td className="py-2 px-2">
                      {r.detail && <div className="text-muted-foreground mb-1">{r.detail}</div>}
                      <div className="flex gap-1 flex-wrap">
                        {r.badges.map((b, bi) => <Badge key={bi} variant="outline" className="text-[9px] px-1.5 py-0">{b}</Badge>)}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{r.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtraPills({ extra }: { extra?: Record<string, any> }) {
  if (!extra) return null;
  const pills: { label: string; value: string }[] = [];

  if (extra.age) pills.push({ label: 'Age', value: String(extra.age) });
  if (extra.gender) pills.push({ label: '', value: extra.gender });
  if (extra.org) pills.push({ label: '🏢', value: extra.org });
  if (extra.marital) pills.push({ label: '', value: extra.marital });
  if (extra.visits && extra.visits > 0) pills.push({ label: '', value: `${extra.visits} visits` });
  if (extra.source) pills.push({ label: '', value: extra.source });
  if (extra.broughtBy) pills.push({ label: 'By', value: extra.broughtBy });
  if (extra.contactName) pills.push({ label: 'Contact', value: extra.contactName });
  if (extra.quality) pills.push({ label: '', value: extra.quality });
  if (extra.followUp === 'Yes') pills.push({ label: '', value: '📋 Follow-up' });
  if (extra.initiative === 'Yes') pills.push({ label: '', value: '⭐ Initiative' });
  if (extra.outcome) pills.push({ label: '', value: extra.outcome });
  if (extra.attended) pills.push({ label: '', value: '✅ Attended' });
  if (extra.points && Number(extra.points) > 0) pills.push({ label: '', value: `${extra.points} pts` });

  if (!pills.length) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {pills.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground leading-none">
          {p.label && <span className="font-medium">{p.label}:</span>}
          <span>{p.value}</span>
        </span>
      ))}
    </div>
  );
}
