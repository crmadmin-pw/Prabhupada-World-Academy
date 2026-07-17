import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Users, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { getAttendanceForDate, conductBvSession } from 'zite-endpoints-sdk';
import type { GetAttendanceForDateOutputType, GetBvslGroupsOutputType } from 'zite-endpoints-sdk';

type Group = GetBvslGroupsOutputType['groups'][0];
type AttendanceMember = GetAttendanceForDateOutputType['members'][0];

interface Props {
  bvslId: string;
  groups: Group[];
}

export default function BvslAttendancePanel({ bvslId, groups }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id || '');
  const [sessionDate, setSessionDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [members, setMembers] = useState<AttendanceMember[]>([]);
  const [presentIds, setPresentIds] = useState<Set<string>>(new Set());
  const [sessionExists, setSessionExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAttendance = useCallback(async (groupId: string, date: string) => {
    if (!groupId || !date) return;
    setLoading(true);
    try {
      const res = await getAttendanceForDate({ groupId, date });
      setMembers(res.members);
      setSessionExists(res.sessionExists);
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
    } catch { toast.error('Failed to load members'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedGroupId && sessionDate) loadAttendance(selectedGroupId, sessionDate);
  }, [selectedGroupId, sessionDate, loadAttendance]);

  const togglePresent = (userDbId: string) => {
    setPresentIds(prev => {
      const next = new Set(prev);
      if (next.has(userDbId)) next.delete(userDbId); else next.add(userDbId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!selectedGroupId) { toast.error('Select a group'); return; }
    setSaving(true);
    try {
      const res = await conductBvSession({
        bvslId,
        groupId: selectedGroupId,
        sessionDate,
        presentUserIds: Array.from(presentIds),
      });
      toast.success(res.message || 'Attendance saved!');
      // Reload to confirm saved state
      await loadAttendance(selectedGroupId, sessionDate);
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
      <div className="flex gap-2 flex-wrap">
        {groups.map(g => (
          <button
            key={g.id}
            onClick={() => setSelectedGroupId(g.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              selectedGroupId === g.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary'
            }`}
          >
            {g.groupName}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 space-y-4">
          {/* Date picker */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <label className="text-sm font-medium whitespace-nowrap">Session Date</label>
              <Input
                type="date"
                value={sessionDate}
                onChange={e => setSessionDate(e.target.value)}
                className="h-9 max-w-[180px]"
              />
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
                  {presentCount}/{totalCount} present
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setPresentIds(new Set(members.map(m => m.userDbId)))}>
                    All Present
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setPresentIds(new Set())}>
                    All Absent
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 max-h-80 overflow-y-auto pr-1">
                {members.map(m => {
                  const isPresent = presentIds.has(m.userDbId);
                  return (
                    <div
                      key={m.userDbId}
                      onClick={() => togglePresent(m.userDbId)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors select-none ${
                        isPresent
                          ? 'border-green-400 bg-green-50 dark:bg-green-950/20'
                          : 'border-border hover:border-muted-foreground'
                      }`}
                    >
                      <Checkbox
                        checked={isPresent}
                        onCheckedChange={() => togglePresent(m.userDbId)}
                        onClick={e => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <p className="text-sm font-medium flex-1">{m.fullName}</p>
                      {isPresent
                        ? <span className="text-xs font-medium text-green-600">Present</span>
                        : <span className="text-xs text-muted-foreground">Absent</span>
                      }
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
