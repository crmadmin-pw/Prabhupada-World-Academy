import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { logOneToOneMeeting, deleteOneToOneMeeting } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import SadhanaContextPanel from './SadhanaContextPanel';

interface Meeting { id: string; guideId: string; memberId: string; weekDate: string; meetingDate: string; durationMinutes: number; notes: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  memberId: string;
  memberName: string;
  weekDate: string;
  existing: Meeting | null;
  guideId?: string;
}

function formatWeekLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function OneToOneLogDialog({ open, onClose, onSaved, memberId, memberName, weekDate, existing, guideId }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [meetingDate, setMeetingDate] = useState(existing?.meetingDate || today);
  const [duration, setDuration] = useState(String(existing?.durationMinutes || ''));
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!meetingDate || !duration) { toast.error('Please fill in date and duration'); return; }
    setSaving(true);
    try {
      await logOneToOneMeeting({ memberId, weekDate, meetingDate, durationMinutes: Number(duration), notes, guideId });
      toast.success('Meeting logged!');
      onSaved();
    } catch { toast.error('Failed to save meeting'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    try {
      await deleteOneToOneMeeting({ meetingId: existing.id });
      toast.success('Meeting removed');
      onSaved();
    } catch { toast.error('Failed to delete'); }
    finally { setDeleting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {existing ? 'Edit' : 'Log'} 1:1 — <span className="font-normal">{memberName}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Week of {formatWeekLabel(weekDate)}</p>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Meeting Date</Label>
              <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Duration (minutes)</Label>
              <Input type="number" min="1" max="300" placeholder="e.g. 20" value={duration} onChange={e => setDuration(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea placeholder="Topics discussed, follow-ups, observations..." value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 text-sm" />
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Sadhana Context</p>
          <SadhanaContextPanel userId={memberId} />
        </div>

        <DialogFooter className="flex-row justify-between gap-2 pt-2">
          {existing && (
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3 w-3 mr-1" /> {deleting ? 'Removing...' : 'Remove'}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : existing ? 'Update' : 'Log Meeting'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
