import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Clock, Package, Phone, CalendarCheck, Users, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getBvslOwnReport } from 'zite-endpoints-sdk';
import type { GetBvslOwnReportOutputType } from 'zite-endpoints-sdk';
import { format, subDays, startOfMonth } from 'date-fns';
import { EmptyState } from '@/shared';

function minutesToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

interface Props { bvslId: string; }

export default function BvslBvReportPanel({ bvslId }: Props) {
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [data, setData] = useState<GetBvslOwnReportOutputType | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await getBvslOwnReport({ startDate, endDate });
      setData(result);
    } catch { toast.error('Failed to load BV report'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [startDate, endDate]);

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-4 gap-y-2 items-center">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium whitespace-nowrap">From:</Label>
          <Input type="date" className="h-8 w-[140px]" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium whitespace-nowrap">To:</Label>
          <Input type="date" className="h-8 w-[140px]" value={endDate} onChange={e => setEndDate(e.target.value)} max={format(new Date(), 'yyyy-MM-dd')} />
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setStartDate(format(startOfMonth(new Date()), 'yyyy-MM-dd')); setEndDate(format(new Date(), 'yyyy-MM-dd')); }}>This Month</Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setStartDate(format(subDays(new Date(), 30), 'yyyy-MM-dd')); setEndDate(format(new Date(), 'yyyy-MM-dd')); }}>Last 30 Days</Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="flex flex-wrap gap-3">
            <SummaryCard icon={Clock} label="Total Preaching" value={minutesToHHMM(summary?.totalPreachingMins || 0)} color="text-primary" />
            <SummaryCard icon={CalendarCheck} label="Sessions" value={summary?.sessionsCount || 0} color="text-primary" />
            <SummaryCard icon={TrendingUp} label="Avg Attendance" value={`${summary?.avgAttendance || 0}%`} color="text-primary" />
            <SummaryCard icon={Package} label="Books" value={summary?.totalBooks || 0} color="text-primary" />
            <SummaryCard icon={Phone} label="Contacts" value={summary?.totalContacts || 0} color="text-primary" />
          </div>

          {/* Preaching History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preaching History ({data.preachingEntries.length} entries)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.preachingEntries.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Date</th>
                        <th className="p-2 text-right font-medium">Calling</th>
                        <th className="p-2 text-right font-medium">1-on-1</th>
                        <th className="p-2 text-right font-medium">Book Dist</th>
                        <th className="p-2 text-right font-medium">RDUA</th>
                        <th className="p-2 text-right font-medium">Plan</th>
                        <th className="p-2 text-right font-medium">Books</th>
                        <th className="p-2 text-right font-medium">Contacts</th>
                        <th className="p-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.preachingEntries.map(e => (
                        <tr key={e.id} className="border-b hover:bg-muted/30">
                          <td className="p-2 whitespace-nowrap">{e.entryDate ? format(new Date(e.entryDate + 'T00:00:00'), 'MMM d') : '—'}</td>
                          <td className="p-2 text-right font-mono text-xs">{minutesToHHMM(e.callingTime)}</td>
                          <td className="p-2 text-right font-mono text-xs">{minutesToHHMM(e.oneOnOneTime)}</td>
                          <td className="p-2 text-right font-mono text-xs">{minutesToHHMM(e.bookDistTime)}</td>
                          <td className="p-2 text-right font-mono text-xs">{minutesToHHMM(e.rduaTime)}</td>
                          <td className="p-2 text-right font-mono text-xs">{minutesToHHMM(e.planTime)}</td>
                          <td className="p-2 text-right">{e.booksDistributed}</td>
                          <td className="p-2 text-right">{e.contactsCollected}</td>
                          <td className="p-2 text-right font-mono font-bold text-primary">{minutesToHHMM(e.totalMinutes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-4"><EmptyState title="No preaching entries in this period" /></div>
              )}
            </CardContent>
          </Card>

          {/* Session History */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Session History ({data.sessions.length} sessions)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.sessions.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Date</th>
                        <th className="p-2 text-left font-medium">Group</th>
                        <th className="p-2 text-left font-medium">Topic</th>
                        <th className="p-2 text-right font-medium">Attendees</th>
                        <th className="p-2 text-right font-medium">Total</th>
                        <th className="p-2 text-right font-medium">Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sessions.map(s => {
                        const rateColor = s.attendancePercent >= 75 ? 'text-green-600' : s.attendancePercent >= 50 ? 'text-amber-600' : 'text-red-500';
                        return (
                          <tr key={s.sessionId} className="border-b hover:bg-muted/30">
                            <td className="p-2 whitespace-nowrap">{s.sessionDate ? format(new Date(s.sessionDate + 'T00:00:00'), 'MMM d') : '—'}</td>
                            <td className="p-2">{s.groupName}</td>
                            <td className="p-2 text-muted-foreground max-w-[200px] truncate">{s.topic || '—'}</td>
                            <td className="p-2 text-right font-medium">{s.presentCount}</td>
                            <td className="p-2 text-right text-muted-foreground">{s.totalMembers}</td>
                            <td className="p-2 text-right">
                              <Badge variant="outline" className={`${rateColor} border-current`}>{s.attendancePercent}%</Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-4"><EmptyState title="No sessions conducted in this period" /></div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color?: string }) {
  return (
    <Card className="flex-1 min-w-[100px]">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${color || 'text-muted-foreground'}`} /><span className="text-xs text-muted-foreground">{label}</span></div>
        <div className={`text-2xl font-bold mt-1 ${color || ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
