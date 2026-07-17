import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import PreachingDrilldownDialog from './PreachingDrilldownDialog';

interface MetricRow {
  centerId: string;
  centerName: string;
  yearlyGoal: number;
  initial: number;
  cumulative: number;
  weeklyData: Record<string, number | null>;
}

interface Props {
  index: number;
  metricLabel: string;
  metricKey: string;
  weeks: { start: string; end: string; label: string }[];
  rows: MetricRow[];
  defaultOpen?: boolean;
  startDate: string;
  endDate: string;
}

const ACCENT_COLORS = ['bg-primary','bg-chart-1','bg-chart-2','bg-chart-3','bg-chart-4','bg-chart-5','bg-primary','bg-chart-1','bg-chart-2'];

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return String(v);
}

type DrilldownState = { centerId: string; centerName: string; weekLabel: string; title: string };

export default function PreachingMetricSection({
  index, metricLabel, metricKey, weeks, rows, defaultOpen = false, startDate, endDate,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  const totals: Record<string, number> = {};
  for (const w of weeks) totals[w.label] = rows.reduce((s, r) => s + (r.weeklyData[w.label] ?? 0), 0);
  const totalGoal = rows.reduce((s, r) => s + (r.yearlyGoal || 0), 0);
  const totalInitial = rows.reduce((s, r) => s + (r.initial || 0), 0);
  const totalCumulative = rows.reduce((s, r) => s + (r.cumulative || 0), 0);

  const openDrilldown = (row: MetricRow, weekLabel: string) => {
    setDrilldown({
      centerId: row.centerId,
      centerName: row.centerName,
      weekLabel,
      title: `${metricLabel} — ${row.centerName}${weekLabel ? ` (${weekLabel})` : ''}`,
    });
  };

  return (
    <>
      <Card className="overflow-hidden border-border">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer select-none hover:bg-muted/30 transition-colors"
          onClick={() => setOpen(!open)}
        >
          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${ACCENT_COLORS[index % ACCENT_COLORS.length]}`} />
          <span className="font-semibold text-sm flex-1">{index + 1}. {metricLabel}</span>
          <span className="text-xs text-muted-foreground">{rows.length} centers</span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>

        {open && (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-max min-w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="sticky left-0 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border whitespace-nowrap min-w-[36px]">#</th>
                  <th className="sticky left-9 z-20 bg-muted/80 px-2 py-2 text-left font-medium border-r border-border whitespace-nowrap min-w-[90px]">Center</th>
                  <th className="px-2 py-2 text-right font-medium border-r border-border whitespace-nowrap min-w-[72px]">Yearly Goal</th>
                  <th className="px-2 py-2 text-right font-medium border-r border-border whitespace-nowrap min-w-[60px]">Initial</th>
                  <th className="px-2 py-2 text-right font-medium border-r border-border whitespace-nowrap min-w-[80px]">Cumulative</th>
                  {weeks.map(w => (
                    <th key={w.label} className="px-2 py-2 text-right font-medium border-r border-border whitespace-nowrap min-w-[90px]">{w.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.centerId} className="border-t border-border hover:bg-muted/20 transition-colors">
                    <td className="sticky left-0 z-10 bg-card px-2 py-1.5 text-muted-foreground border-r border-border">{i + 1}</td>
                    <td className="sticky left-9 z-10 bg-card px-2 py-1.5 font-medium border-r border-border whitespace-nowrap">{row.centerName}</td>
                    <td className="px-2 py-1.5 text-right border-r border-border">{row.yearlyGoal || '—'}</td>
                    <td className="px-2 py-1.5 text-right border-r border-border">{row.initial || '—'}</td>
                    {/* Cumulative — NOT clickable */}
                    <td className="px-2 py-1.5 text-right font-medium border-r border-border">{fmt(row.cumulative)}</td>
                    {weeks.map(w => {
                      const val = row.weeklyData[w.label];
                      const clickable = val != null && val > 0;
                      return (
                        <td
                          key={w.label}
                          className={`px-2 py-1.5 text-right border-r border-border font-mono transition-colors ${
                            clickable
                              ? 'cursor-pointer text-primary underline-offset-2 hover:underline hover:bg-primary/5'
                              : ''
                          }`}
                          onClick={clickable ? () => openDrilldown(row, w.label) : undefined}
                          title={clickable ? `See the ${val} people behind this number` : undefined}
                        >
                          {fmt(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Totals row — NOT clickable */}
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/50 px-2 py-1.5 border-r border-border">—</td>
                  <td className="sticky left-9 z-10 bg-muted/50 px-2 py-1.5 border-r border-border">Total</td>
                  <td className="px-2 py-1.5 text-right border-r border-border">{totalGoal || '—'}</td>
                  <td className="px-2 py-1.5 text-right border-r border-border">{totalInitial || '—'}</td>
                  <td className="px-2 py-1.5 text-right border-r border-border">{Math.round(totalCumulative * 10) / 10}</td>
                  {weeks.map(w => (
                    <td key={w.label} className="px-2 py-1.5 text-right border-r border-border font-mono">
                      {Math.round(totals[w.label] * 10) / 10 || '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {drilldown && (
        <PreachingDrilldownDialog
          open={true}
          onClose={() => setDrilldown(null)}
          title={drilldown.title}
          metricKey={metricKey}
          centerId={drilldown.centerId}
          weekLabel={drilldown.weekLabel}
          startDate={startDate}
          endDate={endDate}
        />
      )}
    </>
  );
}
