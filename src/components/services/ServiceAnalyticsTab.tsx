import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from 'recharts';
import { Trophy, TrendingDown, Users, Target, AlertTriangle, RefreshCw, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { getServiceAnalytics } from 'zite-endpoints-sdk';
import type { GetServiceAnalyticsOutputType } from 'zite-endpoints-sdk';

interface Props { residencyId?: string; }

const WEEK_OPTIONS = [
  { value: '4', label: 'Last 4 weeks' },
  { value: '8', label: 'Last 8 weeks' },
  { value: '12', label: 'Last 12 weeks' },
];

function getColor(rate: number): string {
  if (rate >= 80) return 'hsl(var(--chart-2))';
  if (rate >= 50) return 'hsl(var(--chart-4))';
  return 'hsl(var(--destructive))';
}

export default function ServiceAnalyticsTab({ residencyId }: Props) {
  const [data, setData] = useState<GetServiceAnalyticsOutputType | null>(null);
  const [loading, setLoading] = useState(false);
  const [weeksBack, setWeeksBack] = useState('8');

  useEffect(() => { load(); }, [weeksBack, residencyId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getServiceAnalytics({ residencyId, weeksBack: parseInt(weeksBack) });
      setData(res);
    } catch { toast.error('Failed to load analytics'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />Service Analytics
        </h3>
        <div className="flex items-center gap-2">
          <Select value={weeksBack} onValueChange={setWeeksBack}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {loading && <div className="text-center py-8 text-muted-foreground text-sm">Loading analytics…</div>}

      {data && !loading && (
        <div className="space-y-4">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xl font-bold text-foreground">{data.summary.totalAllocations}</p>
                <p className="text-xs text-muted-foreground">Total Allocations</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xl font-bold text-green-600">
                  {data.summary.totalAllocations > 0
                    ? Math.round((data.summary.totalDone / data.summary.totalAllocations) * 100)
                    : 0}%
                </p>
                <p className="text-xs text-muted-foreground">Completion Rate</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xl font-bold text-destructive">{data.summary.totalOverdue}</p>
                <p className="text-xs text-muted-foreground">Overdue Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <p className={`text-xl font-bold ${data.rotationFairnessScore >= 70 ? 'text-green-600' : data.rotationFairnessScore >= 40 ? 'text-yellow-600' : 'text-destructive'}`}>
                    {data.rotationFairnessScore}
                  </p>
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>
                <p className="text-xs text-muted-foreground">Rotation Fairness</p>
              </CardContent>
            </Card>
          </div>

          {/* Completion Rate per Service */}
          {data.completionRates.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />Completion Rate by Service
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={Math.max(200, data.completionRates.length * 32)}>
                  <BarChart data={data.completionRates} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="serviceName" tick={{ fontSize: 10 }} width={120} />
                    <Tooltip
                      formatter={(value: any, name: string, props: any) => [`${value}% (${props.payload.done}/${props.payload.total})`, 'Completion']}
                      contentStyle={{ fontSize: 11 }}
                    />
                    <Bar dataKey="completionRate" radius={[0, 3, 3, 0]}>
                      {data.completionRates.map((entry, idx) => (
                        <Cell key={idx} fill={getColor(entry.completionRate)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Overdue Trend */}
          {data.overdueTrend.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-destructive" />Overdue Trend (Last {weeksBack} weeks)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={data.overdueTrend} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="overdue" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} name="Overdue" />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--muted-foreground))" strokeWidth={1} dot={false} strokeDasharray="4 4" name="Total" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Top Performers */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-yellow-500" />Top Performers
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.topPerformers.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Not enough data yet</p>
                ) : (
                  <div className="space-y-2">
                    {data.topPerformers.map((p, i) => (
                      <div key={p.userId} className="flex items-center gap-3">
                        <span className={`text-xs font-bold w-5 text-center ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium truncate">{p.userName}</span>
                            <span className="text-xs font-bold text-green-600">{p.completionRate}%</span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-green-500" style={{ width: `${p.completionRate}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground shrink-0">{p.completed}/{p.totalAllocations}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Workload Distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />Workload Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {data.workloadDistribution.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No data</p>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto">
                    {data.workloadDistribution.slice(0, 15).map(w => (
                      <div key={w.userId} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-24 truncate shrink-0">{w.userName}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.min(100, (w.totalAllocations / (data.workloadDistribution[0]?.totalAllocations || 1)) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0 w-6 text-right">{w.totalAllocations}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Coverage Gaps */}
          {data.coverageGaps.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="w-4 h-4" />Coverage Gaps (Last 4 weeks)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-muted-foreground mb-2">Services with zero allocations on these days:</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.coverageGaps.slice(0, 20).map((gap, i) => (
                    <Badge key={i} variant="outline" className="text-xs border-amber-300 bg-amber-50">
                      {gap.serviceName} · {gap.day.slice(0, 3)}
                    </Badge>
                  ))}
                  {data.coverageGaps.length > 20 && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">+{data.coverageGaps.length - 20} more</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
