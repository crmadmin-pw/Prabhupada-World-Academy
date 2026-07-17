import { Button } from '@/components/ui/button';
import { ArrowUpCircle, Loader2, CalendarDays } from 'lucide-react';
import { format, parse, isValid } from 'date-fns';

function formatExamDate(raw: string): string {
  if (!raw) return 'TBD';
  // Try parsing as any date (handles ISO strings like 2026-03-10T00:00:00.000Z)
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return format(d, 'MMMM d, yyyy');
  } catch {}
  // Try M/D/YYYY format (e.g. 3/10/2026)
  try {
    const d = parse(raw, 'M/d/yyyy', new Date());
    if (isValid(d)) return format(d, 'MMMM d, yyyy');
  } catch {}
  return raw;
}

interface Props {
  allChecked: boolean;
  totalRequired: number;
  checkedCount: number;
  nextExamDate: string;
  onApply: () => void;
  loading: boolean;
  submitted: boolean;
  readOnly: boolean;
}

export default function AshrayApplySection({
  allChecked, totalRequired, checkedCount, nextExamDate,
  onApply, loading, submitted, readOnly,
}: Props) {
  if (readOnly) return null;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-4 border-t">
      <Button
        onClick={onApply}
        disabled={!allChecked || loading || submitted}
        className="gap-2"
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <ArrowUpCircle className="w-4 h-4" />}
        {submitted ? '✓ Application Submitted' : 'Apply for Next Level'}
      </Button>

      {!allChecked && !submitted && (
        <span className="text-xs text-muted-foreground">
          {checkedCount}/{totalRequired} items completed
        </span>
      )}

      {nextExamDate && (
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground bg-muted px-3 py-1.5 rounded-md">
          <CalendarDays className="w-4 h-4 text-primary shrink-0" />
          <span>Next Exam: {formatExamDate(nextExamDate)}</span>
        </div>
      )}
    </div>
  );
}
