import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Home, Plane, AlertTriangle, Download, Search,
  ChevronRight, RefreshCw, TrendingDown, Users, Globe,
} from 'lucide-react';
import { getGuideRentTripsOverview, exportRentPayments, exportTrips } from 'zite-endpoints-sdk';
import type { GetGuideRentTripsOverviewOutputType } from 'zite-endpoints-sdk';
import { exportToCsv } from '@/utils/exportCsv';

type OverviewUser = GetGuideRentTripsOverviewOutputType['users'][0];
type Summary = GetGuideRentTripsOverviewOutputType['summary'];

function fmt(n: number) {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function SummaryCards({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }
  const s = summary!;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <Card className="border-l-4 border-l-destructive/70">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rent Outstanding</p>
              <p className={`text-2xl font-bold mt-1 ${s.totalRentOutstanding > 0 ? 'text-destructive' : 'text-green-600'}`}>
                {fmt(s.totalRentOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">across {s.totalUsers} users</p>
            </div>
            <div className="p-2.5 rounded-lg bg-destructive/10">
              <Home className="w-5 h-5 text-destructive" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-primary/70">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trip Dues</p>
              <p className={`text-2xl font-bold mt-1 ${s.totalTripBalance > 0 ? 'text-primary' : 'text-green-600'}`}>
                {fmt(s.totalTripBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {s.usersWithDebt} user{s.usersWithDebt !== 1 ? 's' : ''} with balance
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-primary/10">
              <Plane className="w-5 h-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className={`border-l-4 ${s.totalPendingCorrections > 0 ? 'border-l-amber-400' : 'border-l-green-400'}`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pending Corrections</p>
              <p className={`text-2xl font-bold mt-1 ${s.totalPendingCorrections > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {s.totalPendingCorrections}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {s.totalPendingCorrections > 0 ? 'awaiting review' : 'all clear ✓'}
              </p>
            </div>
            <div className={`p-2.5 rounded-lg ${s.totalPendingCorrections > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
              <AlertTriangle className={`w-5 h-5 ${s.totalPendingCorrections > 0 ? 'text-amber-500' : 'text-green-500'}`} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({ user, onClick }: { user: OverviewUser; onClick: () => void }) {
  return (
    <tr
      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
      onClick={onClick}
    >
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <div>
            <p className="font-medium text-sm">{user.fullName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {user.isResident
                ? <span className="text-xs text-primary flex items-center gap-0.5"><Home className="w-3 h-3" />Resident</span>
                : <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Globe className="w-3 h-3" />NR</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="py-3 px-3 text-right">
        {user.rentOutstanding > 0 ? (
          <div>
            <span className="font-semibold text-sm text-destructive">{fmt(user.rentOutstanding)}</span>
            {user.rentPendingCorrections > 0 && (
              <div><Badge variant="outline" className="text-xs border-amber-300 text-amber-600 mt-0.5">{user.rentPendingCorrections} pending</Badge></div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{user.rentRecords > 0 ? <span className="text-green-600 font-medium">All paid ✓</span> : '—'}</span>
        )}
      </td>
      <td className="py-3 px-3 text-right">
        {user.tripBalance > 0 ? (
          <div>
            <span className="font-semibold text-sm text-primary">{fmt(user.tripBalance)}</span>
            {user.tripPendingCorrections > 0 && (
              <div><Badge variant="outline" className="text-xs border-amber-300 text-amber-600 mt-0.5">{user.tripPendingCorrections} pending</Badge></div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{user.tripRecords > 0 ? <span className="text-green-600 font-medium">All clear ✓</span> : '—'}</span>
        )}
      </td>
      <td className="py-3 px-3 text-right hidden sm:table-cell">
        {user.totalOutstanding > 0 ? (
          <span className="font-bold text-sm">{fmt(user.totalOutstanding)}</span>
        ) : (
          <span className="text-xs text-green-600 font-medium">₹0</span>
        )}
      </td>
      <td className="py-3 px-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
            View <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function RentTripsTab({ guideId }: { guideId: string }) {
  const navigate = useNavigate();
  const [data, setData] = useState<GetGuideRentTripsOverviewOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingRent, setExportingRent] = useState(false);
  const [exportingTrips, setExportingTrips] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);

  useEffect(() => { load(); }, [guideId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getGuideRentTripsOverview({ guideId });
      setData(res);
      // default to showing all if nobody has a balance
      if (res.summary.usersWithDebt === 0) setOnlyWithBalance(false);
    } catch {
      toast.error('Failed to load rent & trips overview');
    } finally {
      setLoading(false);
    }
  };

  const handleExportRent = async () => {
    setExportingRent(true);
    try {
      const result = await exportRentPayments({});
      exportToCsv(result.filename, result.headers, result.rows);
      toast.success('Rent payments exported');
    } catch {
      toast.error('Export failed');
    } finally {
      setExportingRent(false);
    }
  };

  const handleExportTrips = async () => {
    setExportingTrips(true);
    try {
      const result = await exportTrips({});
      exportToCsv(result.filename, result.headers, result.rows);
      toast.success('Trips data exported');
    } catch {
      toast.error('Export failed');
    } finally {
      setExportingTrips(false);
    }
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.users;
    if (onlyWithBalance) list = list.filter(u => u.totalOutstanding > 0 || u.totalPendingCorrections > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u => u.fullName.toLowerCase().includes(q));
    }
    return list;
  }, [data, onlyWithBalance, search]);

  return (
    <div>
      <SummaryCards summary={data?.summary ?? null} loading={loading} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              User Balances
              {data && !loading && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({filtered.length} of {data.users.length})
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={load} disabled={loading} className="h-8 gap-1.5 text-xs">
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />Refresh
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportRent} disabled={exportingRent} className="h-8 gap-1.5 text-xs">
                <Download className="w-3 h-3" />{exportingRent ? 'Exporting…' : 'Export Rent'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportTrips} disabled={exportingTrips} className="h-8 gap-1.5 text-xs">
                <Download className="w-3 h-3" />{exportingTrips ? 'Exporting…' : 'Export Trips'}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap mt-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="balance-filter" checked={onlyWithBalance} onCheckedChange={setOnlyWithBalance} />
              <Label htmlFor="balance-filter" className="text-sm cursor-pointer">Only with outstanding balance</Label>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-3 rounded-full bg-green-50 mb-3">
                <TrendingDown className="w-6 h-6 text-green-500" />
              </div>
              <p className="font-medium text-sm">
                {onlyWithBalance ? 'No outstanding balances' : 'No users found'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {onlyWithBalance ? 'All users are fully settled ✓' : 'Try adjusting your search'}
              </p>
              {onlyWithBalance && (
                <Button variant="link" size="sm" className="mt-2 text-xs" onClick={() => setOnlyWithBalance(false)}>
                  Show all users
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left py-2 px-3 font-medium">User</th>
                    <th className="text-right py-2 px-3 font-medium">Rent Balance</th>
                    <th className="text-right py-2 px-3 font-medium">Trip Balance</th>
                    <th className="text-right py-2 px-3 font-medium hidden sm:table-cell">Total</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(user => (
                    <UserRow
                      key={user.userId}
                      user={user}
                      onClick={() => navigate(`/guide/users/${user.userId}`, { state: { from: '/guide/dashboard' } })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
