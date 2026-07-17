import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar, CheckCircle2, XCircle, RefreshCw, UserPlus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { getAvailabilityOverview, submitAvailability, bulkSubmitAvailability } from 'zite-endpoints-sdk';
import type { GetAvailabilityOverviewOutputType } from 'zite-endpoints-sdk';
import { format, addDays } from 'date-fns';

import { SERVICE_DAYS, SERVICE_DAY_LABELS as SVC_DAY_LABELS_ARR, getServiceWeekByOffset } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];
const DAY_LABELS: Record<string, string> = Object.fromEntries([...SERVICE_DAYS].map((d, i) => [d, SVC_DAY_LABELS_ARR[i]]));

const TIME_SLOTS = [
  { value: 'morning', label: 'Morning', range: '8AM–1PM' },
  { value: 'afternoon', label: 'Afternoon', range: '1–5PM' },
  { value: 'evening', label: 'Evening', range: '5–9PM' },
  { value: 'full_day', label: 'Full Day', range: '8AM–9PM' },
];

const TIME_LABEL: Record<string, string> = {
  early_morning: 'Early Morning', morning: 'Morning', afternoon: 'Afternoon',
  evening: 'Evening', night: 'Night', full_day: 'Full Day',
};
const TIME_RANGE: Record<string, string> = {
  early_morning: '4AM–8AM', morning: '8AM–1PM', afternoon: '1–5PM',
  evening: '5–9PM', night: '8–11PM', full_day: '4AM–9PM',
};
const TIME_ORDER = ['early_morning', 'morning', 'afternoon', 'evening', 'full_day'];
const TIME_COLOR: Record<string, string> = {
  morning: 'bg-yellow-100 text-yellow-800', afternoon: 'bg-orange-100 text-orange-800',
  evening: 'bg-blue-100 text-blue-800', night: 'bg-purple-100 text-purple-800', full_day: 'bg-green-100 text-green-800',
};

type SubmittedUser = GetAvailabilityOverviewOutputType['submitted'][0];

function UserRow({ u }: { u: SubmittedUser }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="py-2 pr-3 text-sm font-medium whitespace-nowrap">{u.userName}</td>
      {DAYS.map(day => {
        const detail = u.dayDetails.find(d => d.day === day);
        if (!detail) return <td key={day} className="py-2 px-1 text-center"><span className="text-muted-foreground/30 text-xs">—</span></td>;
        const colorClass = TIME_COLOR[detail.time] ?? 'bg-green-100 text-green-800';
        return (
          <td key={day} className="py-2 px-1 text-center">
            <div className="inline-flex flex-col items-center gap-0.5">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colorClass}`}>{TIME_LABEL[detail.time] ?? detail.time}</span>
              <span className="text-[9px] text-muted-foreground">{TIME_RANGE[detail.time] ?? ''}</span>
            </div>
          </td>
        );
      })}
      <td className="py-2 pl-2 text-center">
        <Badge variant="secondary" className="text-[10px] px-1.5">{u.availableDays.length}/7</Badge>
      </td>
    </tr>
  );
}

interface SubmitForResidentDialogProps {
  resident: { userId: string; userName: string } | null;
  weekStart: string;
  onClose: () => void;
  onSuccess: () => void;
}

function SubmitForResidentDialog({ resident, weekStart, onClose, onSuccess }: SubmitForResidentDialogProps) {
  const [selectedDays, setSelectedDays] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const toggleDay = (day: string) => {
    setSelectedDays(prev => {
      if (prev[day]) { const n = { ...prev }; delete n[day]; return n; }
      return { ...prev, [day]: 'full_day' };
    });
  };
  const setTime = (day: string, time: string) => setSelectedDays(prev => ({ ...prev, [day]: time }));

  const handleSave = async () => {
    if (!resident) return;
    setSaving(true);
    try {
      const dayDetails = Object.entries(selectedDays).map(([day, time]) => ({ day, time }));
      await submitAvailability({
        weekStartDate: weekStart,
        availableDaysJson: JSON.stringify(dayDetails),
        userId: resident.userId,
      });
      toast.success(`Availability submitted for ${resident.userName}`);
      onSuccess();
    } catch { toast.error('Failed to submit availability'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={!!resident} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Submit Availability for {resident?.userName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-xs text-muted-foreground">Week of {resident && format(new Date(weekStart + 'T00:00:00'), 'd MMM yyyy')}</p>
          {DAYS.map((day, i) => (
            <div key={day} className="flex items-center gap-2">
              <Checkbox
                id={`day-${day}`}
                checked={!!selectedDays[day]}
                onCheckedChange={() => toggleDay(day)}
              />
              <label htmlFor={`day-${day}`} className="text-xs font-medium w-8 cursor-pointer">
                {DAY_LABELS[day]}
              </label>
              <label className="text-xs text-muted-foreground w-16 cursor-pointer">
                {format(addDays(new Date(weekStart + 'T00:00:00'), i), 'd MMM')}
              </label>
              {selectedDays[day] && (
                <div className="flex gap-1 flex-wrap">
                  {TIME_SLOTS.map(ts => (
                    <button
                      key={ts.value}
                      onClick={() => setTime(day, ts.value)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${selectedDays[day] === ts.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
                    >
                      {ts.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || Object.keys(selectedDays).length === 0}>
            {saving ? 'Saving…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AvailabilityOverviewTab() {
  const [data, setData] = useState<GetAvailabilityOverviewOutputType | null>(null);
  const [weekStart, setWeekStart] = useState(getServiceWeekByOffset(1));
  const [loading, setLoading] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<{ userId: string; userName: string } | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  useEffect(() => { load(); }, [weekStart]);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getAvailabilityOverview({ weekStartDate: weekStart }));
    } catch { toast.error('Failed to load availability'); }
    finally { setLoading(false); }
  };

  const handleBulkSubmit = async () => {
    if (!data || data.notSubmitted.length === 0) return;
    setBulkSubmitting(true);
    try {
      const userIds = data.notSubmitted.map(u => u.userId);
      const result = await bulkSubmitAvailability({ weekStartDate: weekStart, userIds });
      toast.success(`Bulk submitted Full Day availability for ${result.submitted} resident${result.submitted !== 1 ? 's' : ''}${result.skipped > 0 ? ` (${result.skipped} already had entries)` : ''}`);
      setShowBulkConfirm(false);
      load();
    } catch {
      toast.error('Failed to bulk submit availability');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(format(d, 'yyyy-MM-dd')); };

  return (
    <div className="space-y-4">
      {/* Week nav */}
      <div className="flex items-center gap-3">
        <button onClick={prevWeek} className="text-muted-foreground hover:text-foreground px-2">←</button>
        <span className="font-medium text-sm flex items-center gap-1.5">
          <Calendar className="w-4 h-4" />
          {format(new Date(weekStart), 'd MMM')} – {format(addDays(new Date(weekStart), 6), 'd MMM yyyy')}
        </span>
        <button onClick={nextWeek} className="text-muted-foreground hover:text-foreground px-2">→</button>
        <button onClick={load} disabled={loading} className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted" title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>}

      {data && !loading && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{data.submitted.length}</p><p className="text-xs text-muted-foreground">Submitted</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-destructive">{data.notSubmitted.length}</p><p className="text-xs text-muted-foreground">Not submitted</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-primary">{data.coverageEstimate}%</p><p className="text-xs text-muted-foreground">Coverage est.</p></CardContent></Card>
          </div>

          <Card>
            <CardContent className="pt-2 pb-3 px-4">
              <Progress value={data.total > 0 ? (data.submitted.length / data.total) * 100 : 0} className="h-1.5" />
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex flex-wrap gap-2 text-xs">
            {TIME_ORDER.map(k => (
              <span key={k} className={`px-2 py-0.5 rounded font-medium ${TIME_COLOR[k]}`}>
                {TIME_LABEL[k]} <span className="opacity-70">({TIME_RANGE[k]})</span>
              </span>
            ))}
          </div>

          {/* Availability Table */}
          {data.submitted.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="w-4 h-4" />Availability Table ({data.submitted.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-xs min-w-[500px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-card">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Name</th>
                      {DAYS.map(d => (
                        <th key={d} className="text-center py-2 px-1 font-medium text-muted-foreground w-16">{DAY_LABELS[d]}</th>
                      ))}
                      <th className="text-center py-2 pl-2 font-medium text-muted-foreground">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.submitted.map(u => <UserRow key={u.userId} u={u} />)}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Not submitted */}
          {data.notSubmitted.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-1.5 text-destructive">
                    <XCircle className="w-4 h-4" />Haven't Submitted ({data.notSubmitted.length})
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={() => setShowBulkConfirm(true)}
                  >
                    <Zap className="w-3 h-3" />
                    Bulk Submit All (Full Day)
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {data.notSubmitted.map(u => (
                    <div key={u.userId} className="flex items-center gap-1.5 border rounded-full pl-2 pr-1 py-0.5 text-xs">
                      <span>{u.userName}</span>
                      <button
                        onClick={() => setSubmitTarget({ userId: u.userId, userName: u.userName })}
                        className="flex items-center gap-0.5 bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] hover:bg-primary/90 transition-colors"
                        title="Submit availability on behalf of this resident"
                      >
                        <UserPlus className="w-2.5 h-2.5" />Submit
                      </button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <SubmitForResidentDialog
        resident={submitTarget}
        weekStart={weekStart}
        onClose={() => setSubmitTarget(null)}
        onSuccess={() => { setSubmitTarget(null); load(); }}
      />

      {/* Bulk Submit Confirmation */}
      <AlertDialog open={showBulkConfirm} onOpenChange={setShowBulkConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bulk Submit Availability</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark <strong>{data?.notSubmitted.length ?? 0} resident{data?.notSubmitted.length !== 1 ? 's' : ''}</strong> as available <strong>Full Day (4AM–9PM)</strong> for all 7 days of the week of{' '}
              <strong>{format(new Date(weekStart + 'T00:00:00'), 'd MMM yyyy')}</strong>.
              <br /><br />
              Residents who have already submitted their availability will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkSubmit} disabled={bulkSubmitting}>
              {bulkSubmitting ? 'Submitting…' : `Submit for ${data?.notSubmitted.length ?? 0} residents`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
