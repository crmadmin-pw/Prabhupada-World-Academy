import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, ClipboardCheck, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useEndpointQuery } from '@/hooks/useEndpointQuery';

type GroupRow = {
  id: string;
  groupId: string;
  groupName: string;
  supervisorNames: string[];
};

type WeekSupervisor = {
  userDbId: string;
  fullName: string;
  visits: number;
  expectedVisits: number;
  status: 'met' | 'short' | 'in_progress' | 'no_session';
};

type WeekSession = {
  date: string;
  totalMinutes: number;
  supervisors: Array<{ userDbId: string; fullName: string; attendedMinutes: number; joined: boolean }>;
};

type WeekRow = {
  weekStart: string;
  weekEnd: string;
  current: boolean;
  sessions: WeekSession[];
  supervisors: WeekSupervisor[];
};

type ReportResponse = {
  groups: GroupRow[];
  report: {
    id: string;
    groupName: string;
    expectedVisits: number;
    supervisors: Array<{ userDbId: string; fullName: string }>;
    weeks: WeekRow[];
  } | null;
};

function calendarDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function weekLabel(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${format(calendarDate(start), sameYear ? 'd MMM' : 'd MMM yyyy')} – ${format(calendarDate(end), 'd MMM yyyy')}`;
}

function statusText(person: WeekSupervisor): string {
  const expected = person.expectedVisits;
  if (person.status === 'no_session') return 'No session was conducted';
  if (person.status === 'met') return `Joined ${person.visits} times · at least ${expected} expected`;
  if (person.status === 'in_progress') return `Joined ${person.visits} of ${expected} expected visits so far`;
  return `Joined ${person.visits} of ${expected} expected visits`;
}

function statusClass(status: WeekSupervisor['status']): string {
  if (status === 'met') return 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200';
  if (status === 'short') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100';
  if (status === 'in_progress') return 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100';
  return 'bg-muted text-muted-foreground';
}

export default function SupervisorReportPanel({ segment }: { segment: 'PW' | 'FOLK' }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const listInput = useMemo(() => ({ segment }), [segment]);
  const detailInput = useMemo(() => ({ segment, groupId: selectedId }), [segment, selectedId]);
  const listQuery = useEndpointQuery<ReportResponse>('getBvSupervisorReport', listInput);
  const detailQuery = useEndpointQuery<ReportResponse>('getBvSupervisorReport', detailInput, !!selectedId);

  const groups = listQuery.data?.groups || [];
  const visibleGroups = groups.filter(group => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return group.groupName.toLowerCase().includes(needle)
      || group.supervisorNames.some(name => name.toLowerCase().includes(needle));
  });
  const report = detailQuery.data?.report;
  const selected = groups.find(group => group.id === selectedId);

  if (selectedId) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setSelectedId('')}>
            <ArrowLeft className="w-4 h-4" />
            Groups
          </Button>
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{selected?.groupName || report?.groupName || 'Reading group'}</h3>
            <p className="text-sm text-muted-foreground">
              {(report?.supervisors.length ? report.supervisors : (selected?.supervisorNames || []).map(fullName => ({ fullName })))
                .map(person => person.fullName)
                .filter(Boolean)
                .join(', ') || 'No supervisor assigned'}
            </p>
          </div>
        </div>

        {detailQuery.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detailQuery.error ? (
          <p className="text-sm text-destructive">{detailQuery.error.message || 'The supervisor report could not be loaded.'}</p>
        ) : report && report.supervisors.length === 0 ? (
          <p className="text-sm text-muted-foreground">This reading group does not have a supervisor assigned yet.</p>
        ) : report ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A supervisor is expected to join this reading group at least {report.expectedVisits} times each week. Every week from the first recorded session through this week is listed below.
            </p>
            {report.weeks.map(week => (
              <section key={week.weekStart} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">
                    {weekLabel(week.weekStart, week.weekEnd)}
                    {week.current ? <span className="ml-2 text-xs font-medium text-primary">Current week</span> : null}
                  </h4>
                </div>
                {week.supervisors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No supervisor profile is linked to this group.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {week.supervisors.map(person => (
                      <p key={person.userDbId} className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(person.status)}`}>
                        {week.supervisors.length > 1 ? `${person.fullName}: ` : ''}{statusText(person)}
                      </p>
                    ))}
                  </div>
                )}
                {week.sessions.length > 0 && (
                  <ul className="space-y-1">
                    {week.sessions.map(session => (
                      <li key={session.date} className="text-sm">
                        <span className="font-medium">{format(calendarDate(session.date), 'EEE, d MMM')}</span>
                        {session.supervisors.map(visit => (
                          <span key={visit.userDbId} className="text-muted-foreground">
                            {' '}· {session.supervisors.length > 1 ? `${visit.fullName} ` : ''}
                            {visit.joined
                              ? `attended ${visit.attendedMinutes} of ${session.totalMinutes} minutes`
                              : `did not join · meeting was ${session.totalMinutes} minutes`}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4" />
          Supervisor visits
        </h3>
        <p className="text-sm text-muted-foreground">
          Open a reading group to see whether its supervisor joined, and for how many minutes of each meeting. The expectation is at least two visits a week.
        </p>
      </div>
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search groups or supervisors"
          className="pl-8 h-9"
          aria-label="Search reading groups"
        />
      </div>
      {listQuery.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : listQuery.error ? (
        <p className="text-sm text-destructive">{listQuery.error.message || 'Reading groups could not be loaded.'}</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{groups.length === 0 ? 'No reading groups yet.' : 'No reading group matches that search.'}</p>
      ) : (
        <div className="grid gap-2">
          {visibleGroups.map(group => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedId(group.id)}
              className="rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary/50 hover:bg-muted/40 transition-colors"
            >
              <p className="text-sm font-medium">{group.groupName}</p>
              <p className="text-xs text-muted-foreground">
                {group.supervisorNames.length > 0 ? group.supervisorNames.join(', ') : 'No supervisor assigned'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
