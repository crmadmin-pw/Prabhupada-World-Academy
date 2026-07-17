import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface WeekVal { weekLabel: string; weekStart: string; value: number }
interface CenterData { centerName: string; centerId: string; cumulative: number; weeks: WeekVal[] }
interface Props {
  metric: string;
  emoji: string;
  centers: CenterData[];
  total: CenterData;
  weeks: { label: string; start: string; end: string }[];
  defaultOpen?: boolean;
  onCellClick: (centerId: string, centerName: string, weekLabel: string, weekStart: string, weekEnd: string) => void;
}

export default function CrossCenterMetricSection({ metric, emoji, centers, total, weeks, defaultOpen = false, onCellClick }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  // Most recent 3 weeks summary (already sorted most-recent-first)
  const last3 = weeks.slice(0, 3);
  const last3Total = last3.map(w => total.weeks.find(tw => tw.weekLabel === w.label)?.value || 0);

  return (
    <Card className="overflow-hidden border-border">
      <div className="flex items-center gap-3 p-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}>
        <span className="text-lg">{emoji}</span>
        <span className="font-semibold text-sm flex-1">{metric}</span>
        <Badge variant="secondary" className="font-mono text-xs">{total.cumulative}</Badge>
        <div className="hidden sm:flex items-center gap-1">
          {last3.map((w, i) => (
            <span key={w.label} className="text-[10px] text-muted-foreground font-mono">
              {w.label}:{last3Total[i]}
            </span>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
      </div>

      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-max min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="sticky left-0 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border w-8">#</th>
                <th className="sticky left-8 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border min-w-[90px]">Center</th>
                <th className="px-2 py-2 text-right font-medium border-r border-border min-w-[80px]">Cumulative</th>
                {weeks.map(w => (
                  <th key={w.label} className="px-2 py-2 text-right font-medium border-r border-border min-w-[60px] whitespace-nowrap">{w.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {centers.map((c, i) => (
                <tr key={c.centerId} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-muted-foreground border-r border-border">{i + 1}</td>
                  <td className="sticky left-8 z-10 bg-card px-2 py-1.5 font-medium border-r border-border whitespace-nowrap">{c.centerName}</td>
                  <CellValue value={c.cumulative} onClick={() => onCellClick(c.centerId, c.centerName, 'Cumulative', weeks[0]?.start || '', weeks[weeks.length - 1]?.end || '')} bold />
                  {c.weeks.map((wv, wi) => (
                    <CellValue key={wv.weekLabel} value={wv.value}
                      onClick={() => onCellClick(c.centerId, c.centerName, wv.weekLabel, weeks[wi].start, weeks[wi].end)} />
                  ))}
                </tr>
              ))}
              {/* TOTAL row */}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/50 px-2 py-1.5 border-r border-border">—</td>
                <td className="sticky left-8 z-10 bg-muted/50 px-2 py-1.5 border-r border-border font-bold">TOTAL</td>
                <CellValue value={total.cumulative} onClick={() => onCellClick('TOTAL', 'TOTAL', 'Cumulative', weeks[0]?.start || '', weeks[weeks.length - 1]?.end || '')} bold />
                {total.weeks.map((wv, wi) => (
                  <CellValue key={wv.weekLabel} value={wv.value}
                    onClick={() => onCellClick('TOTAL', 'TOTAL', wv.weekLabel, weeks[wi].start, weeks[wi].end)} bold />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CellValue({ value, onClick, bold }: { value: number; onClick: () => void; bold?: boolean }) {
  if (value === 0) {
    return <td className={`px-2 py-1.5 text-right border-r border-border text-muted-foreground font-mono ${bold ? 'font-semibold' : ''}`}>0</td>;
  }
  return (
    <td className={`px-2 py-1.5 text-right border-r border-border font-mono cursor-pointer text-primary underline underline-offset-2 hover:bg-primary/5 transition-colors ${bold ? 'font-semibold' : ''}`}
      onClick={onClick} title="Click for details">
      {value}
    </td>
  );
}
