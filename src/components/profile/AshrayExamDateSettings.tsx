import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAshrayExamDate, setAshrayExamDate } from '@/lib/app-endpoints-sdk';

type Department = 'FOLK' | 'PW';

function toInputDate(value: string): string {
  const raw = String(value || '').trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const legacy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  return legacy ? `${legacy[3]}-${legacy[1].padStart(2, '0')}-${legacy[2].padStart(2, '0')}` : '';
}

interface Props {
  department: Department;
}

export default function AshrayExamDateSettings({ department }: Props) {
  const [examDate, setExamDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAshrayExamDate({ segment: department })
      .then(result => { if (!cancelled) setExamDate(toInputDate(result.examDate)); })
      .catch(() => { if (!cancelled) toast.error('Could not load the Ashraya exam date'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [department]);

  const save = async () => {
    setSaving(true);
    try {
      const result = await setAshrayExamDate({ segment: department, examDate });
      setExamDate(toInputDate(result.examDate));
      toast.success(`${department} Ashraya exam date updated`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Could not save the Ashraya exam date');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-4" />
          </span>
          <div>
            <h3 className="font-semibold">Next Ashraya Exam</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This date applies to all {department === 'FOLK' ? 'FOLK' : 'Prabhupada World'} Ashraya levels.
            </p>
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            type="date"
            value={examDate}
            onChange={event => setExamDate(event.target.value)}
            disabled={loading || saving}
            className="h-9 w-full sm:w-44"
            aria-label={`${department} next Ashraya exam date`}
          />
          <Button onClick={() => void save()} disabled={loading || saving} className="h-9 shrink-0 gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
