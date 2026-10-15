import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBvslMembers, recordBvAttendanceMinutes } from '@/lib/endpoints-sdk';
import { toast } from 'sonner';

export default function PwBvAttendancePanel({ bvslId }: { bvslId: string }) {
  const [members, setMembers] = useState<Array<{ userId: string; fullName: string; groupName: string }>>([]);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  const [drafts, setDrafts] = useState<Record<string, { attended: string; session: string }>>({});
  const [savingId, setSavingId] = useState('');

  useEffect(() => {
    if (!bvslId) return;
    getBvslMembers({ bvslId }).then(result => {
      setMembers((result.members || []).map(member => ({
        userId: member.userId,
        fullName: member.fullName,
        groupName: member.groupName,
      })));
    }).catch(() => toast.error('Could not load members for attendance'));
  }, [bvslId]);

  const draft = (userId: string) => drafts[userId] || { attended: '', session: '' };

  const save = async (userId: string, fullName: string) => {
    const row = draft(userId);
    const attended = row.attended.trim() === '' ? null : Math.round(Number(row.attended));
    const session = row.session.trim() === '' ? null : Math.round(Number(row.session));
    if ((attended != null && !Number.isFinite(attended)) || (session != null && !Number.isFinite(session))) {
      toast.error('Enter whole minutes');
      return;
    }
    setSavingId(userId);
    try {
      const saved = await recordBvAttendanceMinutes({
        userId,
        entryDate: date,
        attendedMinutes: attended,
        sessionMinutes: session,
      });
      toast.success(saved.pending
        ? `Saved attendance for ${fullName}. It will score when they submit sadhana.`
        : `Updated ${fullName}: ${saved.scorePercent ?? 0}%`);
    } catch (error: any) {
      toast.error(error?.message || 'Could not save attendance');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">Sadhana attendance minutes</h3>
          <p className="text-sm text-muted-foreground">More than half the session is 10 points, 25–50% is 5, and less is 0.</p>
        </div>
        <label className="text-sm flex items-center gap-2">
          Date
          <Input type="date" className="w-40" value={date} onChange={event => setDate(event.target.value)} />
        </label>
      </div>
      <ul className="divide-y">
        {members.map(member => {
          const row = draft(member.userId);
          return (
            <li key={member.userId} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium">{member.fullName}</p>
                <p className="text-xs text-muted-foreground">{member.groupName}</p>
              </div>
              <Input className="h-8 w-24" inputMode="numeric" placeholder="Attended" aria-label={`Minutes attended by ${member.fullName}`}
                value={row.attended} onChange={event => setDrafts(current => ({ ...current, [member.userId]: { ...row, attended: event.target.value } }))} />
              <Input className="h-8 w-24" inputMode="numeric" placeholder="Session" aria-label={`Session minutes for ${member.fullName}`}
                value={row.session} onChange={event => setDrafts(current => ({ ...current, [member.userId]: { ...row, session: event.target.value } }))} />
              <Button size="sm" variant="outline" disabled={savingId === member.userId} onClick={() => void save(member.userId, member.fullName)}>
                {savingId === member.userId ? '…' : 'Save'}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
