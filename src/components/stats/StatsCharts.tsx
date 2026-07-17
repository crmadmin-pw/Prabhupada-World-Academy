import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format } from 'date-fns';

interface TrendPoint { date: string; avgScorePercent: number | null; submittedCount: number; }

function formatDateLabel(ds: string) {
  try { return format(new Date(ds + 'T00:00:00'), 'MMM d'); }
  catch { return ds; }
}

export function ScoreTrendChart({ data }: { data: TrendPoint[] }) {
  const chartData = data.map(d => ({
    label: formatDateLabel(d.date),
    score: d.avgScorePercent,
    count: d.submittedCount,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          interval={Math.max(0, Math.floor(data.length / 10) - 1)}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          tickFormatter={(v) => `${v}%`}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
          formatter={(val: any, name: string) => {
            if (name === 'score') return [`${val}%`, 'Avg Score'];
            if (name === 'count') return [val, 'Submitted'];
            return [val, name];
          }}
        />
        {/* 75% line — NR threshold */}
        <ReferenceLine y={75} stroke="hsl(var(--chart-3))" strokeDasharray="4 2" strokeWidth={1.5}
          label={{ value: '75% (NR)', position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        {/* 95% line — Resident threshold */}
        <ReferenceLine y={95} stroke="hsl(var(--chart-2))" strokeDasharray="4 2" strokeWidth={1.5}
          label={{ value: '95% (Res)', position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
        <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2}
          dot={false} connectNulls={false} name="score" />
      </LineChart>
    </ResponsiveContainer>
  );
}
