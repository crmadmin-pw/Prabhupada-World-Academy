import { useState, useEffect, useCallback } from 'react';
import { format, startOfWeek, addWeeks, subWeeks, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Save, BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getBvslWeeklyPlan, saveBvslWeeklyPlan, getBvslBooksSummary } from 'zite-endpoints-sdk';
import type { GetBvslWeeklyPlanOutputType } from 'zite-endpoints-sdk';
import WeeklyPlanDayCard from './WeeklyPlanDayCard';

type DayData = {
  goal1: string; goal2: string;
  status1: string; status2: string;
  duration: number; reason: string; success: string;
};

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
];

const emptyDay = (): DayData => ({
  goal1: '', goal2: '', status1: 'White', status2: 'White',
  duration: 0, reason: '', success: '',
});

interface Props {
  userEmail: string;
}

export default function BvslWeeklyPlanTab({ userEmail }: Props) {
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    const ws = startOfWeek(now, { weekStartsOn: 1 });
    return format(ws, 'yyyy-MM-dd');
  });
  const [days, setDays] = useState<Record<DayKey, DayData>>(() => {
    const d: any = {};
    DAYS.forEach(dd => d[dd.key] = emptyDay());
    return d;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [books, setBooks] = useState<{ date: string; bookName: string; quantity: number }[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);

  const weekLabel = (() => {
    const s = new Date(weekStart + 'T00:00:00');
    const e = addDays(s, 6);
    return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
  })();

  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBvslWeeklyPlan({ weekStart });
      if (res.plan) {
        const d: any = {};
        DAYS.forEach(dd => d[dd.key] = (res.plan as any)[dd.key]);
        setDays(d);
      } else {
        const d: any = {};
        DAYS.forEach(dd => d[dd.key] = emptyDay());
        setDays(d);
      }
    } catch { toast.error('Failed to load plan'); }
    finally { setLoading(false); }
  }, [weekStart]);

  const loadBooks = useCallback(async () => {
    try {
      const endDate = format(addDays(new Date(weekStart + 'T00:00:00'), 6), 'yyyy-MM-dd');
      const res = await getBvslBooksSummary({ email: userEmail, startDate: weekStart, endDate });
      setBooks(res.books);
      setTotalBooks(res.totalBooks);
    } catch { /* silent */ }
  }, [weekStart, userEmail]);

  useEffect(() => { loadPlan(); loadBooks(); }, [loadPlan, loadBooks]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBvslWeeklyPlan({ weekStart, ...days } as any);
      toast.success('Weekly plan saved!');
    } catch { toast.error('Failed to save plan'); }
    finally { setSaving(false); }
  };

  const prevWeek = () => {
    const d = subWeeks(new Date(weekStart + 'T00:00:00'), 1);
    setWeekStart(format(d, 'yyyy-MM-dd'));
  };
  const nextWeek = () => {
    const d = addWeeks(new Date(weekStart + 'T00:00:00'), 1);
    setWeekStart(format(d, 'yyyy-MM-dd'));
  };

  const updateDay = (key: DayKey, field: keyof DayData, value: any) => {
    setDays(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  // Stats
  const totalDuration = DAYS.reduce((s, d) => s + (days[d.key]?.duration || 0), 0);
  const allStatuses = DAYS.flatMap(d => [days[d.key]?.status1, days[d.key]?.status2]).filter(Boolean);
  const greenCount = allStatuses.filter(s => s === 'Green').length;
  const redCount = allStatuses.filter(s => s === 'Red').length;

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center justify-between bg-card border rounded-xl p-3 shadow-sm">
        <Button variant="ghost" size="icon" onClick={prevWeek}><ChevronLeft className="w-5 h-5" /></Button>
        <h2 className="font-semibold text-base md:text-lg">{weekLabel}</h2>
        <Button variant="ghost" size="icon" onClick={nextWeek}><ChevronRight className="w-5 h-5" /></Button>
      </div>

      {/* Books summary card */}
      {totalBooks > 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-sm text-emerald-800 dark:text-emerald-300">Books Distributed This Week: {totalBooks}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            {books.map((b, i) => (
              <span key={i} className="text-xs bg-emerald-100 dark:bg-emerald-900 px-2 py-0.5 rounded">
                {b.bookName} × {b.quantity} ({b.date})
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-600" />
              <span className="text-sm text-amber-800 dark:text-amber-300">No books logged this week</span>
            </div>
            <a href="https://sankirtan.zite.so" target="_blank" rel="noopener noreferrer"
              className="text-xs text-amber-700 dark:text-amber-400 underline flex items-center gap-1">
              Log at Sankirtan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card border rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-primary">{totalDuration.toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">Total Hours</div>
        </div>
        <div className="bg-card border rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-green-600">{greenCount}</div>
          <div className="text-xs text-muted-foreground">Completed</div>
        </div>
        <div className="bg-card border rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-red-600">{redCount}</div>
          <div className="text-xs text-muted-foreground">Not Done</div>
        </div>
      </div>

      {/* Day cards */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {DAYS.map(d => (
            <WeeklyPlanDayCard
              key={d.key}
              dayKey={d.key}
              label={d.label}
              short={d.short}
              data={days[d.key]}
              weekStart={weekStart}
              onChange={(field, val) => updateDay(d.key, field, val)}
            />
          ))}
        </div>
      )}

      {/* Save button */}
      <div className="sticky bottom-4 z-10">
        <Button className="w-full h-12 text-base font-semibold shadow-lg" onClick={handleSave} disabled={saving || loading}>
          <Save className="w-5 h-5 mr-2" />
          {saving ? 'Saving...' : 'Save Weekly Plan'}
        </Button>
      </div>
    </div>
  );
}
