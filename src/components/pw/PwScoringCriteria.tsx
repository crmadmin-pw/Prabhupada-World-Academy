import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { PW_FIELDS, PW_TOTAL_POINTS } from '@/lib/pwSadhana';

const RULES: Record<string, { bands: { label: string; points: string }[]; note?: string }> = {
  wakeUp: {
    bands: [
      { label: 'On time', points: '4' },
      { label: 'Up to 60 minutes late', points: '2' },
      { label: 'Later', points: '0' },
    ],
    note: 'A waive-off with a reason scores 4.',
  },
  sleep: {
    bands: [
      { label: 'On time', points: '4' },
      { label: 'Up to 60 minutes late', points: '2' },
      { label: 'Later', points: '0' },
    ],
    note: 'Record the previous night’s sleep time for the selected Sadhana date. Going to sleep past midnight counts as late. A waive-off with a reason scores 4.',
  },
  chanting: {
    bands: [
      { label: '16 × rounds completed ÷ target, capped at 16', points: '' },
    ],
    note: 'A waive-off with a reason scores 16.',
  },
  reading: {
    bands: [
      { label: 'Under 25%', points: '0' },
      { label: '25–50%', points: '2' },
      { label: 'Above 50% to 75%', points: '4' },
      { label: 'Above 75% and under 100%', points: '6' },
      { label: '100% or more', points: '8' },
    ],
  },
  hearing: {
    bands: [{ label: 'Same bands as reading', points: '' }],
    note: 'Hearing the SB class before 10:30 AM is recorded and does not add points.',
  },
  submitted: {
    bands: [
      { label: '6:00 PM on the Sadhana date through 10:00 AM the next day', points: '2' },
      { label: 'After 10:00 AM through 2:00 PM the next day', points: '1' },
      { label: 'After 2:00 PM the next day', points: '0' },
    ],
    note: 'All times are IST. Submission before 6:00 PM on the Sadhana date is blocked. Entries for the previous 7 days are allowed; late entries retain all other applicable points.',
  },
  seva: {
    bands: [{ label: 'Same bands as reading, from the minutes you report', points: '' }],
  },
  bvAttendance: {
    bands: [
      { label: 'More than half the session', points: '10' },
      { label: '25–50%', points: '5' },
      { label: 'Under 25%', points: '0' },
    ],
    note: 'Your RGF or RGSF records the minutes.',
  },
};

export default function PwScoringCriteria() {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/40"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            <span className="block text-sm font-semibold">How this day is scored</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Points earned ÷ points that apply today. A full day is {PW_TOTAL_POINTS}. A field with no target is left out.
            </span>
          </span>
        </div>
        {open
          ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <ul className="border-t px-5">
          {PW_FIELDS.map(field => {
            const rule = RULES[field.key];
            return (
              <li key={field.key} className="border-b py-5 last:border-b-0">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-sm font-medium">{field.label}</p>
                  <p className="shrink-0 text-xs text-muted-foreground">{field.maxPoints} pts</p>
                </div>
                <ul className="mt-3 space-y-2">
                  {rule.bands.map(band => (
                    <li key={band.label} className="flex items-baseline justify-between gap-6 text-sm leading-relaxed text-muted-foreground">
                      <span>{band.label}</span>
                      {band.points && <span className="shrink-0 tabular-nums text-foreground">{band.points}</span>}
                    </li>
                  ))}
                </ul>
                {rule.note && (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{rule.note}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
