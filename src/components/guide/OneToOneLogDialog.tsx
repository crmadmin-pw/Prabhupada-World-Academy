import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { logOneToOneMeeting, deleteOneToOneMeeting } from '@/lib/endpoints-sdk';
import { toast } from 'sonner';
import { Trash2, Phone, PhoneOff, PhoneMissed, Link2, CalendarClock, FileText } from 'lucide-react';
import SadhanaContextPanel from './SadhanaContextPanel';

export const CALL_STATUSES = [
  { value: 'Connected', label: 'Connected', icon: Phone, color: 'text-green-600' },
  { value: 'Did not answer', label: 'Did not answer', icon: PhoneMissed, color: 'text-orange-500' },
  { value: 'Did not place the call', label: 'Did not place the call', icon: PhoneOff, color: 'text-red-500' },
] as const;

export type CallStatus = typeof CALL_STATUSES[number]['value'];

export interface Meeting {
  id: string;
  guideId: string;
  memberId: string;
  weekDate: string;
  meetingDate: string;
  durationMinutes: number;
  notes: string;
  callStatus?: string;
  recordingLink?: string;
  nextCallDate?: string;
  nextCallAgenda?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  memberId: string;
  memberName: string;
  weekDate: string;
  existing: Meeting | null;
  guideId?: string;
  /** When true, all fields are read-only (for RGSF view) */
  readOnly?: boolean;
}

function formatWeekLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function OneToOneLogDialog({ open, onClose, onSaved, memberId, memberName, weekDate, existing, guideId, readOnly }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [meetingDate, setMeetingDate] = useState(existing?.meetingDate || today);
  const [duration, setDuration] = useState(String(existing?.durationMinutes || ''));
  const [notes, setNotes] = useState(existing?.notes || '');
  const [callStatus, setCallStatus] = useState<CallStatus>(CALL_STATUSES.find(status => status.value === existing?.callStatus)?.value || 'Connected');
  const [recordingLink, setRecordingLink] = useState(existing?.recordingLink || '');
  const [nextCallDate, setNextCallDate] = useState(existing?.nextCallDate || '');
  const [nextCallAgenda, setNextCallAgenda] = useState(existing?.nextCallAgenda || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!meetingDate || !duration) { toast.error('Please fill in date and duration'); return; }
    setSaving(true);
    try {
      await logOneToOneMeeting({
        memberId,
        weekDate,
        meetingDate,
        durationMinutes: Number(duration),
        notes,
        guideId,
        callStatus,
        recordingLink: recordingLink.trim() || undefined,
        nextCallDate: nextCallDate || undefined,
        nextCallAgenda: nextCallAgenda.trim() || undefined,
      });
      toast.success('Meeting logged!');
      onSaved();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.trim() : '';
      toast.error(message && !/internal server error/i.test(message) ? message : 'Failed to save meeting');
    }
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

  const statusInfo = CALL_STATUSES.find(s => s.value === callStatus) || CALL_STATUSES[0];
  const StatusIcon = statusInfo.icon;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {readOnly ? 'View' : existing ? 'Edit' : 'Log'} 1:1 — <span className="font-normal">{memberName}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">Week of {formatWeekLabel(weekDate)}</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Call Status */}
          <div>
            <Label className="text-xs font-semibold flex items-center gap-1.5 mb-1.5">
              <Phone className="w-3.5 h-3.5" /> Call Status
            </Label>
            {readOnly ? (
              <div className={`flex items-center gap-2 text-sm font-medium ${statusInfo.color}`}>
                <StatusIcon className="w-4 h-4" />
                {callStatus}
              </div>
            ) : (
              <Select value={callStatus} onValueChange={(v: string) => setCallStatus(v as CallStatus)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALL_STATUSES.map(s => {
                    const SIcon = s.icon;
                    return (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="flex items-center gap-2">
                          <SIcon className={`w-3.5 h-3.5 ${s.color}`} />
                          {s.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Date & Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Meeting Date</Label>
              {readOnly ? (
                <p className="text-sm mt-1">{meetingDate ? new Date(meetingDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</p>
              ) : (
                <Input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className="mt-1" />
              )}
            </div>
            <div>
              <Label className="text-xs">Duration (minutes)</Label>
              {readOnly ? (
                <p className="text-sm mt-1">{duration || '—'} min</p>
              ) : (
                <Input type="number" min="1" max="300" placeholder="e.g. 20" value={duration} onChange={e => setDuration(e.target.value)} className="mt-1" />
              )}
            </div>
          </div>

          {/* Call Notes — hidden for RGSF */}
          {!readOnly && (
            <div>
              <Label className="text-xs">Call Notes</Label>
              <Textarea placeholder="Topics discussed, follow-ups, observations..." value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 text-sm" />
            </div>
          )}

          {/* Call Recording Link — hidden for RGSF */}
          {!readOnly && (
            <div>
              <Label className="text-xs flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> Call Recording Link
              </Label>
              <Input
                type="url"
                placeholder="https://drive.google.com/file/... or recording URL"
                value={recordingLink}
                onChange={e => setRecordingLink(e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
          )}

          <Separator />

          {/* Next Call Section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" /> Next Call Planning
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Next Call Date (tentative)</Label>
                {readOnly ? (
                  <p className="text-sm mt-1">{nextCallDate ? new Date(nextCallDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set'}</p>
                ) : (
                  <Input type="date" value={nextCallDate} onChange={e => setNextCallDate(e.target.value)} className="mt-1" />
                )}
              </div>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Agenda of Next Call
              </Label>
              {readOnly ? (
                <p className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{nextCallAgenda || 'No agenda set'}</p>
              ) : (
                <Textarea
                  placeholder="Points to discuss in the next call..."
                  value={nextCallAgenda}
                  onChange={e => setNextCallAgenda(e.target.value)}
                  rows={2}
                  className="mt-1 text-sm"
                />
              )}
            </div>
          </div>

          {!readOnly && (
            <>
              <Separator />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Sadhana Context</p>
                <SadhanaContextPanel userId={memberId} />
              </div>
            </>
          )}
        </div>

        {!readOnly && (
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
        )}

        {readOnly && (
          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
