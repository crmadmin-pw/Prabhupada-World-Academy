import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, CalendarCheck, RotateCcw, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { getMyAvailability, submitAvailability } from 'zite-endpoints-sdk';
import { format, addDays } from 'date-fns';

import { SERVICE_DAYS, SERVICE_DAY_LABELS, getServiceWeekByOffset } from '@/lib/serviceWeek';
const DAYS = [...SERVICE_DAYS];
const DAY_LABELS = SERVICE_DAY_LABELS;

const TIME_SLOTS = [
  { value: 'early_morning', label: 'Early Morning', shortLabel: 'Early AM', range: '4 AM – 8 AM' },
  { value: 'morning',       label: 'Morning',       shortLabel: 'Morning',  range: '8 AM – 1 PM' },
  { value: 'afternoon',     label: 'Afternoon',     shortLabel: 'Afternoon',range: '1 PM – 5 PM' },
  { value: 'evening',       label: 'Evening',       shortLabel: 'Evening',  range: '5 PM – 9 PM' },
  { value: 'full_day',      label: 'Full Day',      shortLabel: 'Full Day', range: '4 AM – 9 PM' },
];

function weekLabel(ws: string): string {
  const thisWeek = getServiceWeekByOffset(0);
  const nextWeek = getServiceWeekByOffset(1);
  const lastWeek = getServiceWeekByOffset(-1);
  if (ws === thisWeek) return 'This Week';
  if (ws === nextWeek) return 'Next Week';
  if (ws === lastWeek) return 'Last Week';
  return format(new Date(ws + 'T00:00:00'), "'Week of' d MMM");
}

function weekRange(ws: string): string {
  const start = new Date(ws + 'T00:00:00');
  const end = addDays(start, 6);
  return `${format(start, 'd MMM')} – ${format(end, 'd MMM')}`;
}

interface DayAvail { day: string; time: string; }

interface DayCardProps {
  dayKey: string; dayLabel: string; date: string;
  avail: DayAvail | undefined; locked: boolean;
  onToggle: () => void; onTime: (t: string) => void;
}

function DayCard({ dayKey, dayLabel, date, avail, locked, onToggle, onTime }: DayCardProps) {
  const isOn = !!avail;
  return (
    <div className={`rounded-xl border transition-colors ${isOn ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'}`}>
      <button onClick={onToggle} disabled={locked}
        className={`w-full flex items-center justify-between px-3 py-2.5 ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isOn ? 'bg-primary border-primary' : 'border-muted-foreground/40'}`}>
            {isOn && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
          <span className={`text-sm font-semibold ${isOn ? 'text-primary' : 'text-foreground'}`}>
            {dayLabel} <span className="font-normal text-muted-foreground text-xs">{date}</span>
          </span>
        </div>
        {!isOn && <span className="text-[11px] text-muted-foreground/50 hidden sm:block">Tap to mark available</span>}
        {!isOn && <span className="text-[11px] text-muted-foreground/50 sm:hidden">+</span>}
      </button>
      {isOn && (
        <div className="px-3 pb-3 flex flex-wrap gap-1.5">
          {TIME_SLOTS.map(t => {
            const sel = avail?.time === t.value;
            return (
              <button
                key={t.value}
                onClick={() => !locked && onTime(t.value)}
                disabled={locked}
                title={t.range}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  sel
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {/* Show short label on mobile, full label + range on larger screens */}
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label} <span className="opacity-70">({t.range})</span></span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function parseAvails(json: string): DayAvail[] {
  try {
    const p = JSON.parse(json ?? '[]');
    if (!Array.isArray(p) || p.length === 0) return [];
    if (typeof p[0] === 'string') return p.map((d: string) => ({ day: d, time: 'full_day' }));
    return p.map((d: any) => ({ day: d.day, time: d.time ?? 'full_day' }));
  } catch { return []; }
}

export default function UserAvailabilityTab() {
  const [dayAvails, setDayAvails] = useState<DayAvail[]>([]);
  const [weekStart, setWeekStart] = useState(getServiceWeekByOffset(1));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => { load(); }, [weekStart]);

  const load = async () => {
    setLoading(true);
    setEditing(false);
    try {
      const res = await getMyAvailability({ weekStartDate: weekStart });
      if (res.availability) {
        setDayAvails(parseAvails(res.availability.availableDaysJson));
        setSubmittedAt(res.availability.submittedAt || res.availability.updatedAt || null);
      } else {
        setDayAvails([]);
        setSubmittedAt(null);
      }
    } catch { toast.error('Failed to load availability'); }
    finally { setLoading(false); }
  };

  const usePreviousWeek = async () => {
    setLoadingPrev(true);
    try {
      const prevMonday = format(addDays(new Date(weekStart + 'T00:00:00'), -7), 'yyyy-MM-dd');
      const res = await getMyAvailability({ weekStartDate: prevMonday });
      if (res.availability) {
        setDayAvails(parseAvails(res.availability.availableDaysJson));
        toast.success('Loaded from last week ✓');
      } else toast.info('No availability found for last week');
    } catch { toast.error('Failed to load previous week'); }
    finally { setLoadingPrev(false); }
  };

  const toggle = (day: string) => {
    setDayAvails(prev => prev.find(d => d.day === day) ? prev.filter(d => d.day !== day) : [...prev, { day, time: 'full_day' }]);
  };

  const setTime = (day: string, time: string) => {
    setDayAvails(prev => prev.map(d => d.day === day ? { ...d, time } : d));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = dayAvails.map(d => ({ day: d.day, time: d.time, situation: 'available' }));
      await submitAvailability({ weekStartDate: weekStart, availableDaysJson: JSON.stringify(payload) });
      toast.success('Availability saved! ✓');
      setEditing(false);
      await load();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const prevWeek = () => { const d = new Date(weekStart + 'T00:00:00'); d.setDate(d.getDate() - 7); setWeekStart(format(d, 'yyyy-MM-dd')); };
  const nextWeek = () => { const d = new Date(weekStart + 'T00:00:00'); d.setDate(d.getDate() + 7); setWeekStart(format(d, 'yyyy-MM-dd')); };

  const isSubmitted = !!submittedAt;
  const isLocked = isSubmitted && !editing;

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-primary" />Weekly Availability
            </CardTitle>
            {isSubmitted && !editing && (
              <Badge variant="secondary" className="text-xs gap-1 text-green-700 bg-green-100">
                <CheckCircle2 className="w-3 h-3" />Submitted
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Week navigation */}
          <div className="flex items-center gap-2">
            <button onClick={prevWeek} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground border">←</button>
            <div className="flex-1 text-center">
              <p className="font-semibold text-sm">{weekLabel(weekStart)}</p>
              <p className="text-xs text-muted-foreground">{weekRange(weekStart)}</p>
            </div>
            <button onClick={nextWeek} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground border">→</button>
          </div>

          {/* Submitted banner */}
          {isSubmitted && !editing && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <p className="text-xs text-green-700 font-medium">✅ Set for {weekLabel(weekStart)}</p>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0" onClick={() => setEditing(true)}>
                <Pencil className="w-3 h-3" />Edit
              </Button>
            </div>
          )}

          {/* Day cards */}
          {(!isSubmitted || editing) && (
            <>
              <div className="space-y-2">
                {DAYS.map((day, i) => (
                  <DayCard key={day} dayKey={day} dayLabel={DAY_LABELS[i]}
                    date={format(addDays(new Date(weekStart + 'T00:00:00'), i), 'd MMM')}
                    avail={dayAvails.find(a => a.day === day)}
                    locked={false} onToggle={() => toggle(day)} onTime={t => setTime(day, t)}
                  />
                ))}
              </div>

              {/* Action buttons — wrap on mobile */}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" onClick={save} disabled={saving} className="flex-1 sm:flex-none">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />{saving ? 'Saving…' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={usePreviousWeek} disabled={loadingPrev} className="flex-1 sm:flex-none">
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />{loadingPrev ? 'Loading…' : 'Use Last Week'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDayAvails(DAYS.map(d => ({ day: d, time: 'full_day' })))}>All</Button>
                <Button size="sm" variant="outline" onClick={() => setDayAvails([])}>None</Button>
                {editing && (
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); load(); }}>Cancel</Button>
                )}
              </div>
            </>
          )}

          {/* Summary when submitted */}
          {isSubmitted && !editing && (
            <div className="space-y-1 pt-1">
              {DAYS.map((day, i) => {
                const avail = dayAvails.find(a => a.day === day);
                const slot = TIME_SLOTS.find(t => t.value === avail?.time);
                return (
                  <div key={day} className={`flex items-center justify-between text-xs px-3 py-1.5 rounded ${avail ? 'bg-primary/5 text-primary' : 'bg-muted/40 text-muted-foreground'}`}>
                    <span className="font-medium">{DAY_LABELS[i]}, {format(addDays(new Date(weekStart + 'T00:00:00'), i), 'd MMM')}</span>
                    {avail
                      ? <span className="font-medium">{slot?.shortLabel ?? avail.time.replace(/_/g, ' ')}</span>
                      : <span>Not available</span>
                    }
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
