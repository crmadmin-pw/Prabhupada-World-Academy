import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface EntityRow {
  id: string;
  name: string;
  cumulative: number;
  weekValues: { weekId: string; value: number }[];
}

interface Props {
  metric: string;
  emoji: string;
  rows: EntityRow[];
  weeks: { id: string; start: string; end: string }[];
  defaultOpen?: boolean;
  showPoints: boolean;
  onCellClick: (entityId: string, entityName: string, weekId: string, weekStart: string, weekEnd: string) => void;
}

const RANK_EMOJI = ['🥇', '🥈', '🥉'];

export default function ScoresMetricSection({ metric, emoji, rows, weeks, defaultOpen = false, showPoints, onCellClick }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Sort by cumulative descending
  const sorted = [...rows].sort((a, b) => b.cumulative - a.cumulative);
  const totalCum = sorted.reduce((s, r) => s + r.cumulative, 0);

  return (
    <Card className="overflow-hidden border-border">
      <div className="flex items-center gap-3 p-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}>
        <span className="text-lg">{emoji}</span>
        <span className="font-semibold text-sm flex-1">{metric}</span>
        <Badge variant="secondary" className="font-mono text-xs">
          {showPoints ? totalCum.toFixed(1) : Math.round(totalCum)}
        </Badge>
        <span className="text-xs text-muted-foreground">{sorted.length} entries</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>

      {open && sorted.length > 0 && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-max min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="sticky left-0 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border w-8">#</th>
                <th className="sticky left-8 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border min-w-[120px]">Name</th>
                <th className="px-2 py-2 text-right font-medium border-r border-border min-w-[80px]">Cumulative</th>
                {weeks.map(w => (
                  <th key={w.id} className="px-2 py-2 text-right font-medium border-r border-border min-w-[55px] whitespace-nowrap">{w.id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={row.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="sticky left-0 z-10 bg-card px-2 py-1.5 border-r border-border">
                    {i < 3 ? <span className="text-sm">{RANK_EMOJI[i]}</span> : <span className="text-muted-foreground">{i + 1}</span>}
                  </td>
                  <td className="sticky left-8 z-10 bg-card px-2 py-1.5 font-medium border-r border-border whitespace-nowrap truncate max-w-[160px]" title={row.name}>{row.name}</td>
                  <ScoreCell value={row.cumulative} showPoints={showPoints}
                    onClick={() => onCellClick(row.id, row.name, 'Cumulative', weeks[0]?.start || '', weeks[weeks.length - 1]?.end || '')} bold />
                  {row.weekValues.map((wv, wi) => (
                    <ScoreCell key={wv.weekId} value={wv.value} showPoints={showPoints}
                      onClick={() => onCellClick(row.id, row.name, wv.weekId, weeks[wi].start, weeks[wi].end)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ScoreCell({ value, showPoints, onClick, bold }: { value: number; showPoints: boolean; onClick: () => void; bold?: boolean }) {
  const display = showPoints ? (value % 1 === 0 ? String(value) : value.toFixed(1)) : String(Math.round(value));
  if (value === 0) {
    return <td className={`px-2 py-1.5 text-right border-r border-border text-muted-foreground font-mono ${bold ? 'font-semibold' : ''}`}>0</td>;
  }
  return (
    <td className={`px-2 py-1.5 text-right border-r border-border font-mono cursor-pointer text-primary underline underline-offset-2 hover:bg-primary/5 transition-colors ${bold ? 'font-semibold' : ''}`}
      onClick={onClick} title="Click for details">
      {display}
    </td>
  );
}
