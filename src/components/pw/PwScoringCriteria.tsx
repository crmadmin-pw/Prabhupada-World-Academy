import { PW_FIELDS, PW_TOTAL_POINTS } from '@/lib/pwSadhana';

const RULES: Record<string, { lines: string[]; note?: string }> = {
  wakeUp: {
    lines: ['On time — 4', 'Up to 60 minutes late — 2', 'Later — 0'],
    note: 'A waive-off with a reason scores 4.',
  },
  sleep: {
    lines: ['On time — 4', 'Up to 60 minutes late — 2', 'Later — 0'],
    note: 'A wake past midnight counts as late. A waive-off with a reason scores 4.',
  },
  chanting: {
    lines: ['16 × rounds completed ÷ target, capped at 16'],
    note: 'A waive-off with a reason scores 16.',
  },
  reading: {
    lines: ['Under 25% — 0', '25–50% — 2', 'Above 50% to 75% — 4', 'Above 75% and under 100% — 6', '100% or more — 8'],
  },
  hearing: {
    lines: ['Same bands as reading'],
    note: 'Hearing the SB class before 10:30 AM is recorded and does not add points.',
  },
  submitted: {
    lines: ['By the deadline — 2', 'After the deadline and by 2:00 PM — 1', 'Later — 0'],
  },
  seva: {
    lines: ['Same bands as reading, from the minutes you report'],
  },
  bvAttendance: {
    lines: ['More than half the session — 10', '25–50% — 5', 'Under 25% — 0'],
    note: 'Your RGF or RGSF records the minutes.',
  },
};

export default function PwScoringCriteria() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="font-semibold">How this day is scored</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Points earned ÷ points that apply today. A full day is {PW_TOTAL_POINTS}. A field with no target is left out.
      </p>
      <ul className="mt-3 divide-y">
        {PW_FIELDS.map(field => {
          const rule = RULES[field.key];
          return (
            <li key={field.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{field.label}</p>
                <p className="shrink-0 text-xs text-muted-foreground">{field.maxPoints} pts</p>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{rule.lines.join(' · ')}</p>
              {rule.note && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{rule.note}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
