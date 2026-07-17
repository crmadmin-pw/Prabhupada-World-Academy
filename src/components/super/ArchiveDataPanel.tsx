import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Archive, Database, Calendar, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { getArchiveStats, archiveSadhanaData } from 'zite-endpoints-sdk';
import type { GetArchiveStatsOutputType } from 'zite-endpoints-sdk';

function getDefaultCutoff(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().substring(0, 10);
}

export default function ArchiveDataPanel() {
  const [stats, setStats] = useState<GetArchiveStatsOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [cutoffDate, setCutoffDate] = useState(getDefaultCutoff());
  const [archiving, setArchiving] = useState(false);
  const [result, setResult] = useState<{ summarized: number; deleted: number; months: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArchiveStats({}).then(setStats).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleArchive = async () => {
    setArchiving(true);
    setError(null);
    setResult(null);
    try {
      const res = await archiveSadhanaData({ cutoffDate, confirm: 'ARCHIVE' });
      setResult(res);
      // Refresh stats after archive
      const fresh = await getArchiveStats({});
      setStats(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed. Please try again.');
    } finally {
      setArchiving(false);
    }
  };

  const entriesBeforeCutoff = stats
    ? `${stats.totalEntries}${stats.hasMoreEntries ? '+' : ''} entries`
    : '—';

  const formattedLastArchive = stats?.lastArchivedAt
    ? new Date(stats.lastArchivedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Archive className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Archive Old Sadhana Data</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Summarize old entries into monthly aggregates and delete raw data to keep the app fast
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Current stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Database className="w-3.5 h-3.5" />
              <span className="text-xs">Raw Entries</span>
            </div>
            {loading ? <Skeleton className="h-6 w-16 mx-auto" /> : (
              <p className="font-bold text-lg text-foreground">
                {stats ? `${stats.totalEntries}${stats.hasMoreEntries ? '+' : ''}` : '—'}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Calendar className="w-3.5 h-3.5" />
              <span className="text-xs">Oldest Entry</span>
            </div>
            {loading ? <Skeleton className="h-6 w-20 mx-auto" /> : (
              <p className="font-bold text-sm text-foreground">
                {stats?.oldestEntryDate
                  ? new Date(stats.oldestEntryDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                  : '—'}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Archive className="w-3.5 h-3.5" />
              <span className="text-xs">Summaries</span>
            </div>
            {loading ? <Skeleton className="h-6 w-12 mx-auto" /> : (
              <p className="font-bold text-lg text-foreground">{stats?.totalSummaries ?? '—'}</p>
            )}
          </div>
        </div>

        {formattedLastArchive && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
            Last archived: {formattedLastArchive}
          </div>
        )}

        {/* Cutoff date selector */}
        <div className="space-y-2">
          <Label htmlFor="cutoff-date" className="text-sm font-medium">
            Archive entries older than
          </Label>
          <div className="flex gap-2 items-center">
            <Input
              id="cutoff-date"
              type="date"
              value={cutoffDate}
              onChange={e => setCutoffDate(e.target.value)}
              className="w-48"
              max={new Date().toISOString().substring(0, 10)}
            />
            <span className="text-xs text-muted-foreground">
              Entries before this date will be summarized &amp; deleted
            </span>
          </div>
        </div>

        <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-xs text-amber-700 dark:text-amber-400">
            <strong>This action is irreversible.</strong> Raw entries will be deleted after summarization.
            Monthly aggregates (avg score, rounds, sick days, etc.) are preserved.
            Entries from the last 3 months are kept by default.
          </AlertDescription>
        </Alert>

        {/* Success result */}
        {result && (
          <Alert className="bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-xs text-green-700 dark:text-green-400">
              <strong>Archive complete!</strong> Summarized {result.summarized} user-month groups,
              deleted {result.deleted} raw entries.
              {result.months.length > 0 && (
                <span> Months archived: {result.months.slice(0, 6).join(', ')}
                  {result.months.length > 6 ? ` +${result.months.length - 6} more` : ''}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}

        {/* Archive button with confirmation */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              className="w-full gap-2"
              disabled={archiving || loading || !cutoffDate}
            >
              {archiving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
              {archiving ? 'Archiving…' : 'Archive & Clean Up'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm Data Archival</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>This will summarize all sadhana entries older than <strong>{cutoffDate}</strong> into monthly aggregates and delete the raw entries.</p>
                  <div className="rounded-lg bg-muted p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current raw entries</span>
                      <span className="font-medium">{entriesBeforeCutoff}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cutoff date</span>
                      <span className="font-medium">{cutoffDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Data preserved as</span>
                      <span className="font-medium">Monthly summaries</span>
                    </div>
                  </div>
                  <p className="text-destructive text-sm font-medium">⚠️ This cannot be undone. Raw entry data will be permanently deleted.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleArchive}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Yes, Archive &amp; Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Archived months summary */}
        {stats && stats.totalSummaries > 0 && (
          <div className="pt-1">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">{stats.totalSummaries}</span> monthly summary records stored •
              Raw entries can be safely deleted for archived months
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
