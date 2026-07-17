import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Users, CheckCircle2, XCircle, TrendingUp, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { getBvGroupSadhanaMonitor } from 'zite-endpoints-sdk';
import BvSadhanaGroupRow from './BvSadhanaGroupRow';

interface Props { guideId: string; }

type MonitorData = { targetDate: string; summary: { totalGroups: number; totalMembers: number; filledToday: number; pendingToday: number; fillRate: number; weeklyAvgRate: number }; groups: any[] };

function SummaryCard({ icon: Icon, value, label, color }: { icon: any; value: string | number; label: string; color: string }) {
  return (
    <Card><CardContent className="p-4 text-center">
      <Icon className={`w-5 h-5 mx-auto mb-1 ${color}`} />
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </CardContent></Card>
  );
}

export default function BvSadhanaMonitorPanel({ guideId }: Props) {
  const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).toISOString().split('T')[0];
  const [date, setDate] = useState(todayIST);
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [guideId, date]);

  const load = async () => {
    setLoading(true);
    try {
      setData(await getBvGroupSadhanaMonitor({ guideId, date }));
    } catch { toast.error('Failed to load sadhana monitor'); }
    finally { setLoading(false); }
  };

  const frc = (r: number) => r >= 80 ? 'text-green-600' : r >= 50 ? 'text-yellow-600' : 'text-destructive';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40 h-8 text-sm" max={todayIST} />
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <p className="text-xs text-muted-foreground ml-auto">Each BV group = a mini centre. Expand rows to see individual members.</p>
      </div>

      {loading && <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>}

      {data && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard icon={Users} value={data.summary.totalGroups} label="BV Groups" color="text-primary" />
            <SummaryCard icon={Users} value={data.summary.totalMembers} label="Total Members" color="text-muted-foreground" />
            <SummaryCard icon={CheckCircle2} value={`${data.summary.fillRate}%`} label="Today's Fill Rate" color={frc(data.summary.fillRate)} />
            <SummaryCard icon={TrendingUp} value={`${data.summary.weeklyAvgRate}%`} label="7-Day Avg Fill" color={frc(data.summary.weeklyAvgRate)} />
          </div>

          {data.groups.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <XCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No active BV groups found. Create groups in the "Groups & Members" tab.</p>
            </CardContent></Card>
          ) : (
            <Card>
              <CardContent className="pt-0 px-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[650px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Group</th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">BVSL Leader</th>
                      <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">Members</th>
                      <th className="text-center py-2.5 px-3 font-medium text-green-700">Filled</th>
                      <th className="text-center py-2.5 px-3 font-medium text-destructive">Pending</th>
                      <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">Today %</th>
                      <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">7d Avg</th>
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.groups]
                      .sort((a, b) => a.fillPercent - b.fillPercent)
                      .map(g => (
                        <BvSadhanaGroupRow key={g.groupDbId} group={g} targetDate={date} />
                      ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Click any group row to expand and see individual member details. Use the 💬 Nudge button to send a WhatsApp message to the BVSL leader.
          </p>
        </div>
      )}
    </div>
  );
}
