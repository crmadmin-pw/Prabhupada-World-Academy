import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquarePlus } from 'lucide-react';

export interface Meeting { id: string; guideId: string; memberId: string; weekDate: string; meetingDate: string; durationMinutes: number; notes: string; }
export interface Member {
  userId: string; fullName: string; ashrayLevel: string | null; isResident: boolean;
  eligibility: string; delegateId: string | null; delegateName: string | null;
}

interface Props {
  members: Member[];
  meetings: Meeting[];
  weeks: string[];
  groupByAshray?: boolean;
  onCellClick: (memberId: string, memberName: string, weekDate: string, existing: Meeting | null) => void;
}

const ASHRAY_ORDER = ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha'];

function formatWeekLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function weeksSince(meetings: Meeting[], userId: string, weeks: string[]): number {
  const userMeetings = meetings.filter(m => m.memberId === userId);
  if (userMeetings.length === 0) return 999;
  const latestWeek = userMeetings.reduce((a, m) => m.weekDate > a ? m.weekDate : a, '');
  const idx = weeks.indexOf(latestWeek);
  if (idx === -1) return 999;
  return weeks.length - 1 - idx;
}

function getMeetingForCell(meetings: Meeting[], userId: string, weekDate: string): Meeting | null {
  return meetings.find(m => m.memberId === userId && m.weekDate === weekDate) || null;
}

function GapBadge({ gap }: { gap: number }) {
  if (gap === 999) return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Never</Badge>;
  if (gap >= 3) return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{gap}w</Badge>;
  if (gap === 0) return <Badge className="text-[10px] px-1.5 py-0 bg-green-600">This wk</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{gap}w ago</Badge>;
}

function EligibilityBadge({ eligibility, delegateName }: { eligibility: string; delegateName: string | null }) {
  if (!eligibility || eligibility === 'Guide') return null;
  if (eligibility === 'Delegated') {
    return (
      <span className="inline-block text-[9px] px-1 py-0 rounded bg-blue-100 text-blue-700 border border-blue-200 font-medium leading-4 truncate max-w-[90px]">
        → {delegateName || 'BVSL'}
      </span>
    );
  }
  return (
    <span className="inline-block text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground border border-border font-medium leading-4">
      Not Eligible
    </span>
  );
}

type TableRow =
  | { type: 'member'; member: Member; rowIdx: number }
  | { type: 'section'; label: string; count: number; overdueCount: number };

export default function OneToOneMatrix({ members, meetings, weeks, groupByAshray, onCellClick }: Props) {
  const rows = useMemo<TableRow[]>(() => {
    const sortedByGap = (arr: Member[]) =>
      [...arr].sort((a, b) => weeksSince(meetings, b.userId, weeks) - weeksSince(meetings, a.userId, weeks));

    if (!groupByAshray) {
      return sortedByGap(members).map((m, i) => ({ type: 'member', member: m, rowIdx: i }));
    }

    const result: TableRow[] = [];
    let rowIdx = 0;
    const grouped: Record<string, Member[]> = {};
    const unknown: Member[] = [];
    members.forEach(m => {
      const lvl = m.ashrayLevel;
      if (lvl && ASHRAY_ORDER.includes(lvl)) {
        grouped[lvl] = grouped[lvl] || [];
        grouped[lvl].push(m);
      } else {
        unknown.push(m);
      }
    });

    for (const level of ASHRAY_ORDER) {
      const group = grouped[level];
      if (!group || group.length === 0) continue;
      const sorted = sortedByGap(group);
      const overdueCount = sorted.filter(m => weeksSince(meetings, m.userId, weeks) >= 3).length;
      result.push({ type: 'section', label: level, count: group.length, overdueCount });
      sorted.forEach(m => { result.push({ type: 'member', member: m, rowIdx: rowIdx++ }); });
    }

    if (unknown.length > 0) {
      const sorted = sortedByGap(unknown);
      const overdueCount = sorted.filter(m => weeksSince(meetings, m.userId, weeks) >= 3).length;
      result.push({ type: 'section', label: 'No Level', count: unknown.length, overdueCount });
      sorted.forEach(m => { result.push({ type: 'member', member: m, rowIdx: rowIdx++ }); });
    }

    return result;
  }, [members, meetings, weeks, groupByAshray]);

  return (
    <TooltipProvider>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse" style={{ minWidth: `${280 + weeks.length * 90}px` }}>
          <thead>
            <tr className="bg-muted/60">
              <th className="sticky left-0 z-10 bg-muted/60 text-left px-3 py-2 font-semibold text-xs w-48 min-w-[180px] border-b border-border">Member</th>
              <th className="px-2 py-2 text-center font-semibold text-xs w-20 border-b border-border border-l">Gap</th>
              {weeks.map(w => (
                <th key={w} className="px-2 py-2 text-center font-medium text-xs border-b border-l border-border w-24">{formatWeekLabel(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              if (row.type === 'section') {
                return (
                  <tr key={`section-${row.label}`}>
                    <td colSpan={weeks.length + 2} className="px-3 py-1.5 bg-muted/40 border-b border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{row.label}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">{row.count}</span>
                        {row.overdueCount > 0 && (
                          <span className="text-[10px] text-destructive bg-destructive/10 rounded-full px-1.5 py-0.5 font-medium">
                            {row.overdueCount} overdue
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              const { member, rowIdx } = row;
              const gap = weeksSince(meetings, member.userId, weeks);
              const evenBg = 'hsl(var(--background))';
              const oddBg = 'hsl(var(--muted) / 0.2)';
              const bg = rowIdx % 2 === 0 ? evenBg : oddBg;

              return (
                <tr key={member.userId} className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                  <td className="sticky left-0 z-10 px-3 py-2 border-b border-border" style={{ background: bg }}>
                    <div className="truncate max-w-[170px] font-medium">{member.fullName}</div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {member.ashrayLevel && (
                        <span className="text-[10px] text-muted-foreground truncate">{member.ashrayLevel}</span>
                      )}
                      <EligibilityBadge eligibility={member.eligibility} delegateName={member.delegateName} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center border-b border-l border-border">
                    <GapBadge gap={gap} />
                  </td>
                  {weeks.map(weekDate => {
                    const mtg = getMeetingForCell(meetings, member.userId, weekDate);
                    return (
                      <td key={weekDate} className="px-1 py-1 text-center border-b border-l border-border">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onCellClick(member.userId, member.fullName, weekDate, mtg)}
                              className={`w-full h-8 rounded text-xs font-medium transition-all flex items-center justify-center gap-0.5
                                ${mtg ? 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-300' : 'hover:bg-muted/60 text-muted-foreground/40 border border-dashed border-border'}`}
                            >
                              {mtg ? (mtg.durationMinutes > 0 ? `${mtg.durationMinutes}m` : '✓') : <MessageSquarePlus className="h-3 w-3" />}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs max-w-[200px]">
                            {mtg
                              ? <span>{mtg.durationMinutes}min on {mtg.meetingDate}{mtg.notes ? ` · ${mtg.notes.slice(0, 60)}${mtg.notes.length > 60 ? '...' : ''}` : ''}</span>
                              : <span>Click to log 1:1</span>
                            }
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rows.filter(r => r.type === 'member').length === 0 && (
              <tr><td colSpan={weeks.length + 2} className="text-center py-10 text-muted-foreground text-sm">No members found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
