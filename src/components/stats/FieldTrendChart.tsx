/**
 * FieldTrendChart — single-select field trend chart
 * Shows one field at a time with its actual Y-axis values (no normalisation).
 * Chip selects which field to display.
 */
import { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { fmt } from '@/lib/fmt';

export interface FieldConfig {
  key: string;
  label: string;
  unit: string;
  yMax?: number;
}

// Fixed distinct colors per field key
const FIELD_COLORS: Record<string, string> = {
  scorePercent: 'hsl(var(--primary))',
  rounds:       'hsl(217, 75%, 52%)',
  roundsCount:  'hsl(217, 75%, 52%)',
  spReadingMinutes: 'hsl(150, 58%, 42%)',
  preachingMinutes: 'hsl(25, 80%, 50%)',
  booksDistributed: 'hsl(88, 55%, 40%)',
  sbPoints:         'hsl(270, 62%, 56%)',
  maNaGvPoints:     'hsl(185, 65%, 40%)',
  quotesTulasi:     'hsl(30, 70%, 48%)',
  bath:             'hsl(195, 72%, 48%)',
  japaVisible:      'hsl(160, 60%, 44%)',
  cleanlinessPoints: 'hsl(328, 62%, 54%)',
  reportSending:    'hsl(46, 78%, 44%)',
  dailyServicePoints: 'hsl(235, 60%, 58%)',
  sleepQualityPoints: 'hsl(300, 55%, 52%)',
  sleepHours:       'hsl(200, 72%, 48%)',
  studyMinutes:     'hsl(55, 70%, 45%)',
  reading:          'hsl(165, 60%, 44%)',
  hearing:          'hsl(270, 62%, 56%)',
  fillingSameDay:   'hsl(140, 55%, 42%)',
  seva:             'hsl(15, 72%, 52%)',
  bhaktiVriksha:    'hsl(120, 48%, 40%)',
};

const FALLBACK_COLORS = [
  'hsl(217,75%,52%)', 'hsl(150,58%,42%)', 'hsl(25,80%,50%)',
  'hsl(270,62%,56%)', 'hsl(185,65%,40%)', 'hsl(328,62%,54%)',
];

function getColor(key: string, idx: number): string {
  return FIELD_COLORS[key] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
}

// ── Exported field config presets (used in GuideUserDetailPage & StatsOverviewPanel) ──

export const RESIDENT_FIELD_CONFIGS: FieldConfig[] = [
  { key: 'scorePercent',    label: 'Overall %',       unit: '%',   yMax: 100 },
  { key: 'rounds',          label: 'Rounds',           unit: '',    yMax: 32 },
  { key: 'spReadingMinutes',label: 'SP Reading',       unit: 'min', yMax: 120 },
  { key: 'sbPoints',        label: 'SB',               unit: 'pts', yMax: 2 },
  { key: 'maNaGvPoints',   label: 'MA/NA/GV',         unit: 'pts', yMax: 2 },
  { key: 'quotesTulasi',    label: 'Quotes + Tulasi',  unit: 'pts', yMax: 2 },
  { key: 'bath',            label: 'Bath',             unit: 'pts', yMax: 1 },
  { key: 'japaVisible',     label: 'Japa Visible',     unit: 'pts', yMax: 1 },
  { key: 'cleanlinessPoints', label: 'Cleanliness',    unit: 'pts', yMax: 2 },
  { key: 'reportSending',   label: 'Report Sending',   unit: 'pts', yMax: 1 },
  { key: 'dailyServicePoints', label: 'Daily Service', unit: 'pts', yMax: 2 },
  { key: 'sleepQualityPoints', label: 'Sleep Quality', unit: 'pts', yMax: 1 },
  { key: 'sleepHours',      label: 'Sleep Hours',      unit: 'hrs', yMax: 10 },
  { key: 'studyMinutes',    label: 'Study',            unit: 'min', yMax: 180 },
  { key: 'preachingMinutes',label: 'Preaching',        unit: 'min', yMax: 180 },
  { key: 'booksDistributed',label: 'Books',            unit: '',    yMax: 20 },
];

export const NR_FIELD_CONFIGS: FieldConfig[] = [
  { key: 'scorePercent',    label: 'Overall %',     unit: '%',   yMax: 100 },
  { key: 'rounds',          label: 'Chanting',      unit: '',    yMax: 32 },
  { key: 'reading',         label: 'Reading',       unit: 'min', yMax: 90 },
  { key: 'hearing',         label: 'Hearing',       unit: 'min', yMax: 90 },
  { key: 'fillingSameDay',  label: 'Same Day',      unit: 'pts', yMax: 1 },
  { key: 'seva',            label: 'Seva',          unit: 'Yes/No', yMax: 1 },
  { key: 'bhaktiVriksha',   label: 'BV Attended',   unit: 'Yes/No', yMax: 1 },
];

interface DataPoint {
  label: string;
  [key: string]: any;
}

interface FieldTrendChartProps {
  data: DataPoint[];
  fieldConfigs?: FieldConfig[];
  isResident?: boolean;
  defaultSelected?: string;
  height?: number;
  loading?: boolean;
  showThreshold?: boolean;
}

function CustomTooltip({ active, payload, label, cfg }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-xs min-w-[120px]">
      <p className="font-semibold mb-1 text-foreground">{label}</p>
      <div className="flex justify-between gap-4">
        <span className="font-medium" style={{ color: payload[0]?.color }}>{cfg?.label}</span>
        <span className="font-bold text-foreground">
          {val != null ? `${fmt.numDisplay(val)}${cfg?.unit ? ` ${cfg.unit}` : ''}` : '—'}
        </span>
      </div>
    </div>
  );
}

export default function FieldTrendChart({
  data,
  fieldConfigs,
  isResident = true,
  defaultSelected,
  height = 220,
  loading = false,
  showThreshold = false,
}: FieldTrendChartProps) {
  const configs = fieldConfigs ?? (isResident ? RESIDENT_FIELD_CONFIGS : NR_FIELD_CONFIGS);
  const [selected, setSelected] = useState<string>(defaultSelected ?? configs[0]?.key ?? 'scorePercent');

  // If configs change and selected is no longer valid, reset to first
  useEffect(() => {
    if (!configs.find(c => c.key === selected)) {
      setSelected(configs[0]?.key ?? 'scorePercent');
    }
  }, [configs]);

  const cfg = configs.find(c => c.key === selected) ?? configs[0];
  const cfgIdx = configs.findIndex(c => c.key === selected);
  const lineColor = getColor(selected, cfgIdx);

  const chartData = useMemo(() => data.map(point => ({
    label: point.label,
    value: point[selected] != null ? Number(point[selected]) : null,
  })), [data, selected]);

  if (loading) return <Skeleton className="w-full" style={{ height: height + 52 }} />;
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
        No data for this period
      </div>
    );
  }

  const threshold = isResident ? 95 : 75;
  const yDomain: [number, any] = [0, cfg?.yMax ?? 'auto'];

  const yTickFormatter = (v: number) => {
    if (!cfg) return String(v);
    if (cfg.unit === '%') return `${v}%`;
    if (cfg.unit === 'hrs') return `${v}h`;
    if (cfg.unit === 'min') return `${v}m`;
    return String(v);
  };

  return (
    <div>
      {/* Single-select chips */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {configs.map((c, i) => {
          const isOn = c.key === selected;
          const color = getColor(c.key, i);
          return (
            <button
              key={c.key}
              onClick={() => setSelected(c.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                isOn
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground/30'
              }`}
              style={isOn ? { backgroundColor: color, borderColor: color } : {}}
            >
              {c.label}
              {c.unit ? <span className="opacity-70 ml-0.5 text-[10px]">{c.unit}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 5, right: 16, left: -8, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            interval={Math.max(0, Math.floor(chartData.length / 7) - 1)}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={yTickFormatter}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip cfg={cfg} />} />
          {showThreshold && selected === 'scorePercent' && (
            <ReferenceLine
              y={threshold}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 2"
              strokeWidth={1}
              label={{ value: `${threshold}%`, position: 'insideTopRight', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            name={cfg?.label}
            stroke={lineColor}
            strokeWidth={selected === 'scorePercent' ? 2.5 : 2}
            dot={{ r: 2, fill: lineColor, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
