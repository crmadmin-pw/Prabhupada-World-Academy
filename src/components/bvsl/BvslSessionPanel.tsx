import { useEffect, useState, useCallback } from 'react';
import { useUnsavedWork } from '@/lib/formActivity';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Users, CheckCircle2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import GroupSelect from '@/components/bvsl/GroupSelect';
import { toast } from 'sonner';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { format } from 'date-fns';
import { getAttendanceForDate, conductBvSession } from '@/lib/endpoints-sdk';
import type { GetAttendanceForDateOutputType, GetBvslGroupsOutputType } from '@/lib/endpoints-sdk';

type Group = GetBvslGroupsOutputType['groups'][0];
type AttendanceMember = GetAttendanceForDateOutputType['members'][0];

interface Props {
  bvslId: string;
  groups: Group[];
}

export default function BvslAttendancePanel({ bvslId, groups }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id || '');
  const [sessionDate, setSessionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [totalMeetingMinutes, setTotalMeetingMinutes] = useState(60);
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [attendedMinutesMap, setAttendedMinutesMap] = useState<Record<string, number>>({});
  const [localMinutesMap, setLocalMinutesMap] = useState<Record<string, string>>({});
  const [sessionExists, setSessionExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  useUnsavedWork(hasUnsavedChanges || saving);

  const loadAttendance = useReactiveLoader(async (read, groupId: string, date: string, silent = false) => {
    if (!groupId || !date) return;
    if (!silent && !read.background) setLoading(true);
    try {
      const res = await read(() => getAttendanceForDate({ groupId, date }));
      setMembers(res.members);
      setSessionExists(res.sessionExists);
      if (res.totalMeetingMinutes) setTotalMeetingMinutes(res.totalMeetingMinutes);

      const minutesMap: Record<string, number> = {};
      res.members.forEach((m: any) => {
        if (m.userDbId) {
          minutesMap[m.userDbId] = typeof m.attendedMinutes === 'number' ? m.attendedMinutes : (m.present ? (res.totalMeetingMinutes || 60) : 0);
        }
      });
      setAttendedMinutesMap(minutesMap);
      // Sync local display map too
      setLocalMinutesMap(Object.fromEntries(Object.entries(minutesMap).map(([k, v]) => [k, String(v)])));

      // Pre-populate: if session exists, use saved values; otherwise mark all present
      if (res.sessionExists) {
        const presentSet = new Set<string>(
          res.members.filter((m: AttendanceMember) => m.present === true).map((m: AttendanceMember) => m.userDbId as string)
        );
        setPresentIds(presentSet);
      } else {
        // Default: all present for a new date
        setPresentIds(new Set(res.members.map((m: AttendanceMember) => m.userDbId)));
      }
    } catch { if (!read.cancelled && !read.background) toast.error('Failed to load members'); }
    finally { if (!read.cancelled && !silent) setLoading(false); }
  }, [], !hasUnsavedChanges && !saving);

  useEffect(() => {
    setHasUnsavedChanges(false);
    if (selectedGroupId && sessionDate) loadAttendance(selectedGroupId, sessionDate);
  }, [selectedGroupId, sessionDate, loadAttendance]);

  const togglePresent = (userDbId: string) => {
    setHasUnsavedChanges(true);
    setPresentIds(prev => {
      const next = new Set(prev);
      if (next.has(userDbId)) {
        next.delete(userDbId);
        setAttendedMinutesMap(m => ({ ...m, [userDbId]: 0 }));
        setLocalMinutesMap(m => ({ ...m, [userDbId]: '0' }));
      } else {
        next.add(userDbId);
        setAttendedMinutesMap(m => ({ ...m, [userDbId]: totalMeetingMinutes }));
        setLocalMinutesMap(m => ({ ...m, [userDbId]: String(totalMeetingMinutes) }));
      }
      return next;
    });
  };

  const handleAttendedMinutesChange = (userDbId: string, val: number) => {
    setHasUnsavedChanges(true);
    const clamped = Math.max(0, Math.min(totalMeetingMinutes, val));
    setAttendedMinutesMap(prev => ({ ...prev, [userDbId]: clamped }));
    if (clamped > 0 && !presentIds.has(userDbId)) {
      setPresentIds(prev => new Set(prev).add(userDbId));
    } else if (clamped === 0 && presentIds.has(userDbId)) {
      setPresentIds(prev => {
        const next = new Set(prev);
        next.delete(userDbId);
        return next;
      });
    }
  };

  const commitMinutes = (userDbId: string, raw: string) => {
    const parsed = parseInt(raw, 10);
    const val = isNaN(parsed) ? 0 : parsed;
    const clamped = Math.max(0, Math.min(totalMeetingMinutes, val));
    setLocalMinutesMap(m => ({ ...m, [userDbId]: String(clamped) }));
    handleAttendedMinutesChange(userDbId, clamped);
  };

  const handleSave = async () => {
    if (!selectedGroupId) { toast.error('Select a group'); return; }
    setSaving(true);
    try {
      const memberAttendance = members.map(m => ({
        userDbId: m.userDbId,
        present: presentIds.has(m.userDbId),
        attendedMinutes: presentIds.has(m.userDbId) ? (attendedMinutesMap[m.userDbId] ?? totalMeetingMinutes) : 0,
      }));

      const res = await conductBvSession({
        bvslId,
        groupId: selectedGroupId,
        sessionDate,
        totalMeetingMinutes,
        memberAttendance,
        presentUserIds: Array.from(presentIds),
      } as any);
      toast.success(res.message || 'Attendance saved!');
      setSessionExists(true);
      setHasUnsavedChanges(false);
      await loadAttendance(selectedGroupId, sessionDate, true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save attendance');
    } finally { setSaving(false); }
  };

  if (groups.length === 0) return (
    <div className="text-center py-12 text-muted-foreground">
      <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium">No groups found</p>
      <p className="text-sm mt-1">Create a BV group first to mark attendance.</p>
    </div>
  );

  const presentCount = presentIds.size;
  const totalCount = members.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CheckSquare className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Mark Attendance</h3>
      </div>

      {/* Group selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-card p-3 rounded-xl border border-border/80 shadow-xs">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Select Reading Group:</span>
        </div>
        <GroupSelect
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
        />
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          {/* Date & Meeting Duration picker */}
          <div className="flex items-center justify-between gap-4 flex-wrap border-b border-border pb-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Session Date</label>
              <Input
                type="date"
                value={sessionDate}
                onChange={e => setSessionDate(e.target.value)}
                className="h-9 max-w-[170px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Total Meeting Duration</label>
              <Input
                type="number"
                min={15}
                max={300}
                value={totalMeetingMinutes}
                onChange={e => { setHasUnsavedChanges(true); setTotalMeetingMinutes(Math.max(1, parseInt(e.target.value) || 60)); }}
                className="h-9 w-20 text-center font-bold"
              />
              <span className="text-xs text-muted-foreground font-medium">mins</span>
            </div>
            {sessionExists && !loading && (
              <Badge className="bg-green-100 text-green-700 border-green-300 gap-1 text-xs">
                <CheckCircle2 className="w-3 h-3" /> Previously saved
              </Badge>
            )}
          </div>

          {/* Member list */}
          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : members.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {presentCount}/{totalCount} present (Meeting: {totalMeetingMinutes} mins)
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => {
                      setPresentIds(new Set(members.map(m => m.userDbId)));
                      setHasUnsavedChanges(true);
                      const m: Record<string, number> = {};
                      members.forEach(mem => { m[mem.userDbId] = totalMeetingMinutes; });
                      setAttendedMinutesMap(m);
                    }}>
                    All Present
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => {
                      setPresentIds(new Set());
                      setHasUnsavedChanges(true);
                      setAttendedMinutesMap({});
                    }}>
                    All Absent
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 max-h-80 overflow-y-auto pr-1">
                {members.map(m => {
                  const isPresent = presentIds.has(m.userDbId);
                  const attMinutes = attendedMinutesMap[m.userDbId] ?? (isPresent ? totalMeetingMinutes : 0);
                  return (
                    <div
                      key={m.userDbId}
                      onClick={() => togglePresent(m.userDbId)}
                      className={`flex items-center justify-between gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors select-none ${
                        isPresent
                          ? 'border-green-400 bg-green-50 dark:bg-green-950/20'
                          : 'border-border hover:border-muted-foreground'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Checkbox
                          checked={isPresent}
                          onCheckedChange={() => togglePresent(m.userDbId)}
                          onClick={e => e.stopPropagation()}
                          className="shrink-0"
                        />
                        <p className="text-sm font-medium truncate">{m.fullName}</p>
                      </div>

                      {/* Attended Time Input & Label */}
                      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        {isPresent ? (
                          <div className="flex items-center gap-1.5 bg-background border border-green-300 dark:border-green-800 px-2 py-0.5 rounded-md shadow-xs">
                            <span className="text-[11px] text-muted-foreground font-medium">Attended:</span>
                            <input
                              type="number"
                              min={0}
                              max={totalMeetingMinutes}
                              value={localMinutesMap[m.userDbId] ?? String(attMinutes)}
                              onChange={e => {
                                // Allow free typing by keeping local string state
                                setHasUnsavedChanges(true);
                                setLocalMinutesMap(prev => ({ ...prev, [m.userDbId]: e.target.value }));
                              }}
                              onBlur={e => commitMinutes(m.userDbId, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitMinutes(m.userDbId, (e.target as HTMLInputElement).value); }}
                              onClick={e => e.stopPropagation()}
                              className="w-12 h-6 text-center text-xs font-bold bg-transparent focus:outline-none focus:ring-1 focus:ring-primary rounded"
                            />
                            <span className="text-[11px] text-muted-foreground">/ {totalMeetingMinutes} mins</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground font-normal">Absent (0 mins)</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : selectedGroupId ? (
            <p className="text-sm text-muted-foreground text-center py-4">No members in this group yet.</p>
          ) : null}

          <Button
            onClick={handleSave}
            disabled={saving || !selectedGroupId || members.length === 0 || loading}
            className="w-full"
          >
            {saving ? 'Saving...' : sessionExists ? 'Update Attendance' : 'Save Attendance'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
