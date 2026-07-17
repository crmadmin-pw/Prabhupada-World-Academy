import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { getEntryDetail, getBvPreachingEntry, GetEntryDetailOutputType, GetBvPreachingEntryOutputType } from 'zite-endpoints-sdk';

type EntryData = NonNullable<GetEntryDetailOutputType['entry']>;
type BvEntry = NonNullable<GetBvPreachingEntryOutputType['entry']>;

interface Props {
  userId: string;
  entryDate: string | null;
  onClose: () => void;
}

function ScoreBadge({ scorePercent, totalScore }: { scorePercent: number | null; totalScore: number }) {
  const display = scorePercent != null ? `${scorePercent}%` : String(totalScore);
  const color = scorePercent == null ? 'secondary'
    : scorePercent >= 75 ? 'default'
    : scorePercent >= 50 ? 'secondary'
    : 'destructive';
  return <Badge variant={color as any} className="text-base px-3 py-1">{display}</Badge>;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start py-2 border-b last:border-0 gap-2">
      <span className="text-sm text-muted-foreground flex-1">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

function SadhanaContent({ entry }: { entry: EntryData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ScoreBadge scorePercent={entry.scorePercent} totalScore={entry.totalScore} />
        {entry.maxScore && <span className="text-xs text-muted-foreground">out of {entry.maxScore}</span>}
        {entry.flagSick && <Badge variant="outline">🤒 Sick</Badge>}
        {entry.flagOs && <Badge variant="outline">✈️ OS</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        Submitted at {format(new Date(entry.submittedAt), 'h:mm a')}
        {entry.templateMode && ` · ${entry.templateMode.replace('_TEMPLATE', '')}`}
      </p>
      <div className="rounded-lg border bg-muted/30 px-3">
        {(entry.fields ?? []).length === 0
          ? <p className="text-sm text-muted-foreground py-3 text-center">No field details available.</p>
          : (entry.fields ?? []).map(f => (
            <div key={f.fieldKey} className="flex justify-between items-start py-2 border-b last:border-0 gap-2">
              <span className="text-sm text-muted-foreground flex-1">{f.fieldLabel}</span>
              <div className="text-right flex items-center gap-2">
                <span className="text-sm font-medium">{f.displayValue}</span>
                {f.points !== undefined && f.maxPoints !== undefined && f.maxPoints > 0 && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${f.points > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {f.points}/{f.maxPoints}
                  </span>
                )}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

function BvContent({ entry }: { entry: BvEntry }) {
  const totalH = Math.floor(entry.totalPreachingMinutes / 60);
  const totalM = entry.totalPreachingMinutes % 60;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Submitted at {entry.submittedAt ? format(new Date(entry.submittedAt), 'h:mm a') : '—'}</p>
      <div className="rounded-lg border bg-muted/30 px-3">
        <FieldRow label="Time in Calling" value={entry.callingTime} />
        <FieldRow label="Time in 1-on-1" value={entry.oneOnOneTime} />
        <FieldRow label="Book Distribution Time" value={entry.bookDistTime} />
        <FieldRow label="RDUA Hosting Time" value={entry.rduaTime} />
        <FieldRow label="Preaching Plan Time" value={entry.planTime} />
        <FieldRow label="Books Distributed" value={String(entry.booksDistributed)} />
        <FieldRow label="Contacts Collected" value={String(entry.contactsCollected)} />
        <FieldRow label="1-to-1s (Unique)" value={String(entry.uniqueOneOnOnes)} />
      </div>
      <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
        <p className="text-xs text-muted-foreground">Total Preaching Hours</p>
        <p className="text-lg font-bold text-primary">{totalH}h {totalM}m</p>
      </div>
    </div>
  );
}

export default function EntryDetailModal({ userId, entryDate, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [entry, setEntry] = useState<EntryData | null>(null);
  const [bvEntry, setBvEntry] = useState<BvEntry | null>(null);

  useEffect(() => {
    if (!entryDate) { setEntry(null); setBvEntry(null); return; }
    setLoading(true);
    Promise.all([
      (getEntryDetail as any)({ userId, entryDate })
        .then((res: any) => setEntry(res.found ? res.entry ?? null : null))
        .catch(() => setEntry(null)),
      (getBvPreachingEntry as any)({ userId, entryDate })
        .then((res: any) => setBvEntry(res.found ? res.entry ?? null : null))
        .catch(() => setBvEntry(null)),
    ]).finally(() => setLoading(false));
  }, [userId, entryDate]);

  const open = !!entryDate;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {entryDate ? format(new Date(entryDate + 'T00:00:00'), 'EEEE, MMMM d yyyy') : 'Entry Details'}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="space-y-3 py-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}

        {!loading && !entry && !bvEntry && (
          <p className="text-muted-foreground text-sm py-4 text-center">No entry found for this date.</p>
        )}

        {!loading && (entry || bvEntry) && (
          bvEntry ? (
            <Tabs defaultValue="sadhana">
              <TabsList className="w-full">
                <TabsTrigger value="sadhana" className="flex-1">Sadhana</TabsTrigger>
                <TabsTrigger value="bv" className="flex-1">Bhakti Vriksha</TabsTrigger>
              </TabsList>
              <TabsContent value="sadhana" className="mt-3">
                {entry ? (
                  <SadhanaContent entry={entry} />
                ) : (
                  <p className="text-muted-foreground text-sm py-4 text-center">No Sadhana entry for this date.</p>
                )}
              </TabsContent>
              <TabsContent value="bv" className="mt-3">
                <BvContent entry={bvEntry} />
              </TabsContent>
            </Tabs>
          ) : entry ? (
            <SadhanaContent entry={entry} />
          ) : null
        )}
      </DialogContent>
    </Dialog>
  );
}
