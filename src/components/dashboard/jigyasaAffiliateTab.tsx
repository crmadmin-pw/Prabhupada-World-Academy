import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { GraduationCap, ChevronDown, ChevronRight, Clock, Users, TrendingUp } from 'lucide-react';
import { getMyJigyasaRegistrations } from 'zite-endpoints-sdk';
import { EmptyState } from '@/shared';

type Registration = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  totalSessions: number;
  totalDurationSeconds: number;
  totalDuration: string;
  sessions: { sessionDate: string; durationSeconds: number; durationDisplay: string }[];
};

export default function JigyasaAffiliateTab() {
  const [data, setData] = useState<{ registrations: Registration[]; stats: { total: number; attendedAtLeast1: number; avgSessions: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getMyJigyasaRegistrations({})
      .then((res: any) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }

  if (!data || data.registrations.length === 0) {
    return <EmptyState icon={GraduationCap} title="No Jigyasa registrations found" />;
  }

  const { registrations, stats } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <GraduationCap className="w-5 h-5 text-primary" />
          My Jigyasa Registrations
        </h2>
        <span className="text-sm text-muted-foreground">{stats.total} people</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border rounded-lg p-3 text-center bg-card">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-xl font-bold">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Registered</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-card">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-xl font-bold">{stats.attendedAtLeast1}</p>
          <p className="text-xs text-muted-foreground">Attended ≥1</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-card">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          <p className="text-xl font-bold">{stats.avgSessions}</p>
          <p className="text-xs text-muted-foreground">Avg Sessions</p>
        </div>
      </div>

      {/* Registrant list */}
      <div className="border rounded-xl divide-y bg-card">
        {registrations.map(reg => {
          const isExpanded = expanded === reg.id;
          return (
            <div key={reg.id}>
              <button
                className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
                onClick={() => setExpanded(isExpanded ? null : reg.id)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{reg.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[reg.city, reg.state].filter(Boolean).join(', ')}
                    {reg.totalSessions > 0
                      ? ` · ${reg.totalSessions} session${reg.totalSessions !== 1 ? 's' : ''} · ${reg.totalDuration}`
                      : ' · 0 sessions'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {reg.totalSessions > 0 ? (
                    <Badge variant="secondary" className="text-xs">{reg.totalSessions}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">—</Badge>
                  )}
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
              {isExpanded && reg.sessions.length > 0 && (
                <div className="px-3 pb-3">
                  <div className="border rounded-lg divide-y bg-muted/30">
                    {reg.sessions.map((s, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {s.sessionDate ? new Date(s.sessionDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </span>
                        <span className="font-medium">{s.durationDisplay || formatDur(s.durationSeconds)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {isExpanded && reg.sessions.length === 0 && (
                <div className="px-3 pb-3">
                  <p className="text-xs text-muted-foreground text-center py-2">No sessions attended yet</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
