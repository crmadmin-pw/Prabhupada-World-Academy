import { PW_FIELDS, PW_TOTAL_POINTS } from '@/lib/pwSadhana';

const RULES: Record<string, string> = {
  wakeUp: 'On time 4 · up to 60 minutes late 2 · later 0. A waive-off with a reason scores 4.',
  sleep: 'On time 4 · up to 60 minutes late 2 · later 0. A wake past midnight counts as late. A waive-off with a reason scores 4.',
  chanting: '16 × rounds completed ÷ target, capped at 16. A waive-off with a reason scores 16.',
  reading: 'Under 25% is 0 · 25–50% is 2 · above 50% to 75% is 4 · above 75% and under 100% is 6 · 100% or more is 8.',
  hearing: 'Same bands as reading. Hearing the SB class before 10:30 AM is recorded and does not add points.',
  submitted: 'By the deadline is 2 · after the deadline and by 2:00 PM is 1 · later is 0.',
  seva: 'Same bands as reading, from the minutes you report.',
  bvAttendance: 'More than half the session is 10 · 25–50% is 5 · under 25% is 0. Your RGF or RGSF records the minutes.',
};

export default function PwScoringCriteria() {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <p className="font-semibold">How this day is scored</p>
        <p className="text-xs text-muted-foreground">
          Points earned ÷ points that apply today. A full day is {PW_TOTAL_POINTS}. A field with no target is left out, so it does not lower the percentage.
        </p>
      </div>
      <ul className="space-y-2">
        {PW_FIELDS.map(field => (
          <li key={field.key} className="text-sm">
            <span className="font-medium">{field.label}</span>
            <span className="text-muted-foreground"> · {field.maxPoints} pts. {RULES[field.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
