import { useState } from 'react';
import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { NON_RESIDENT_FIELDS } from '@/config/sadhanaFields';

interface Props {
  ashrayLevel: string;
}

function normalizeLevel(level: string): string {
  return (level || '').trim().replace(/_/g, ' ');
}

export default function NRScoringCriteria({ ashrayLevel }: Props) {
  const [open, setOpen] = useState(false);
  const level = normalizeLevel(ashrayLevel);
  const levelU = level.replace(/ /g, '_');

  if (!level) return null;

  const rows: { label: string; target: string; points: number }[] = [];

  for (const f of NON_RESIDENT_FIELDS) {
    const crit = f.criteria as any;
    if (!crit?.levels) continue;
    const target = crit.levels[level] ?? crit.levels[levelU];
    if (!target || target === '-') continue;

    let targetLabel = '';
    if (typeof target === 'string' && target.includes('leaderboard')) {
      targetLabel = 'Tracked (leaderboard)';
    } else if (target === 'enabled') {
      targetLabel = 'Required (tracked)';
    } else {
      targetLabel = String(target);
    }

    rows.push({
      label: f.fieldLabel,
      target: targetLabel,
      points: crit.total_points || 0,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Your Scoring Targets ({level})</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-muted-foreground">Field</span>
            <span className="font-semibold text-muted-foreground text-right">Target</span>
            <span className="font-semibold text-muted-foreground text-right">Max Pts</span>
            {rows.map(r => (
              <div key={r.label} className="contents">
                <span className="text-foreground">{r.label}</span>
                <span className="text-primary font-medium text-right">{r.target}</span>
                <span className="text-muted-foreground text-right">{r.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
