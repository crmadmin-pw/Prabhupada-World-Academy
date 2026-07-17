import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAttendanceEventsAdmin, createAttendanceEvent, createAttendanceSession,
  manageAttendanceVolunteers,
} from 'zite-endpoints-sdk';
import type { GetAttendanceEventsAdminOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Copy, Users, Settings, Flame, Link2, ChevronDown, ChevronUp, X, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

type EventItem = GetAttendanceEventsAdminOutputType['events'][0];
type SessionItem = EventItem['sessions'][0];

export default function AttendanceManagePage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    getAttendanceEventsAdmin({}).then(r => setEvents(r.events)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')}><ArrowLeft className="w-5 h-5 text-muted-foreground" /></button>
            <h1 className="text-lg font-bold">Attendance Events</h1>
          </div>
          <CreateEventDialog onCreated={reload} />
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-4">
        {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
        {!loading && events.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3"><Link2 className="w-6 h-6 text-muted-foreground" /></div>
            <h2 className="font-semibold mb-1">No events yet</h2>
            <p className="text-sm text-muted-foreground">Create your first attendance event to get started.</p>
          </div>
        )}
        {events.map(event => <EventCard key={event.id} event={event} onReload={reload} />)}
      </div>
    </div>
  );
}

function EventCard({ event, onReload }: { event: EventItem; onReload: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const total = event.sessions.reduce((s, ses) => s + ses.attendeeCount, 0);

  return (
    <div className="border border-border rounded-lg p-5 bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{event.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {event.startDate && event.endDate ? `${format(new Date(event.startDate + 'T00:00:00'), 'MMM d')} – ${format(new Date(event.endDate + 'T00:00:00'), 'MMM d, yyyy')}` : ''} · {event.sessions.length} session{event.sessions.length !== 1 ? 's' : ''} · {total} total check-in{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="p-1 text-muted-foreground">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <>
          <div className="mt-4 space-y-2">
            {event.sessions.map(ses => <SessionRow key={ses.id} session={ses} />)}
          </div>
          <div className="mt-3 flex gap-3 flex-wrap">
            <CreateSessionDialog eventId={event.id} onCreated={onReload} />
            {event.sessions.length > 0 && <VolunteerDialog sessions={event.sessions} />}
          </div>
        </>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: SessionItem }) {
  const link = `${window.location.origin}/attend/${session.shareToken}`;
  const copy = () => { navigator.clipboard.writeText(link); toast.success('Link copied!'); };

  return (
    <div className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm truncate">{session.name}</span>
        <span className="text-xs text-muted-foreground">· {session.attendeeCount} check-in{session.attendeeCount !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {session.challengeEnabled && (
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded flex items-center gap-1">
            <Flame className="w-3 h-3" /> {session.challengeDays}-day
          </span>
        )}
        <button onClick={copy} className="p-1 text-muted-foreground hover:text-foreground"><Copy className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function CreateEventDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [customFields, setCustomFields] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !start || !end) { toast.error('Title, start and end dates are required'); return; }
    setSubmitting(true);
    try {
      await createAttendanceEvent({ title: title.trim(), description: desc, startDate: start, endDate: end, customFields: customFields || undefined });
      toast.success('Event created!');
      setOpen(false);
      setTitle(''); setDesc(''); setStart(''); setEnd(''); setCustomFields('');
      onCreated();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Event</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create Attendance Event</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Title *</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sunday Feast Program" /></div>
          <div><Label>Description</Label><Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Event description..." rows={2} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start Date *</Label><Input type="date" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div><Label>End Date *</Label><Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
          <div>
            <Label>Custom Registration Fields (JSON)</Label>
            <Textarea
              value={customFields}
              onChange={e => setCustomFields(e.target.value)}
              placeholder={`[{"name":"City","type":"text"},{"name":"Age Group","type":"select","options":["18-25","26-35","36+"]}]`}
              rows={3}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">Optional. JSON array of extra fields for the registration form.</p>
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Creating...' : 'Create Event'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateSessionDialog({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [challengeEnabled, setChallengeEnabled] = useState(false);
  const [challengeTitle, setChallengeTitle] = useState('');
  const [challengeDesc, setChallengeDesc] = useState('');
  const [challengeInstructions, setChallengeInstructions] = useState('');
  const [challengeDays, setChallengeDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { toast.error('Session name is required'); return; }
    setSubmitting(true);
    try {
      const res = await createAttendanceSession({
        eventId, name: name.trim(), challengeEnabled,
        challengeTitle: challengeEnabled ? challengeTitle : undefined,
        challengeDescription: challengeEnabled ? challengeDesc : undefined,
        challengeInstructions: challengeEnabled ? challengeInstructions : undefined,
        challengeDays: challengeEnabled ? challengeDays : undefined,
      });
      const link = `${window.location.origin}/attend/${res.shareToken}`;
      navigator.clipboard.writeText(link);
      toast.success('Session created! Link copied to clipboard.');
      setOpen(false);
      setName(''); setChallengeEnabled(false);
      onCreated();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs text-primary font-medium flex items-center gap-1"><Plus className="w-3 h-3" /> Add Session</button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Session</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Session Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Main Hall Kirtan" /></div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Challenge</Label>
              <p className="text-xs text-muted-foreground">Participants can join a streak challenge</p>
            </div>
            <Switch checked={challengeEnabled} onCheckedChange={setChallengeEnabled} />
          </div>
          {challengeEnabled && (
            <div className="space-y-3 border border-border rounded-lg p-4 bg-muted/20">
              <div><Label>Challenge Title</Label><Input value={challengeTitle} onChange={e => setChallengeTitle(e.target.value)} placeholder="e.g. 7-Day Kirtan Challenge" /></div>
              <div><Label>Description</Label><Textarea value={challengeDesc} onChange={e => setChallengeDesc(e.target.value)} rows={2} /></div>
              <div><Label>Instructions</Label><Textarea value={challengeInstructions} onChange={e => setChallengeInstructions(e.target.value)} rows={2} /></div>
              <div><Label>Challenge Days</Label><Input type="number" value={challengeDays} onChange={e => setChallengeDays(Number(e.target.value) || 7)} min={1} max={365} /></div>
            </div>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>{submitting ? 'Creating...' : 'Create Session'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VolunteerDialog({ sessions }: { sessions: SessionItem[] }) {
  const [open, setOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState(sessions[0]?.id || '');
  const [email, setEmail] = useState('');
  const [volunteers, setVolunteers] = useState<Array<{ id: string; userName: string; userEmail: string }>>([]);
  const [loading, setLoading] = useState(false);

  const loadVols = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const res = await manageAttendanceVolunteers({ action: 'list', sessionId: sid });
      setVolunteers(res.volunteers);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { if (open && selectedSession) loadVols(selectedSession); }, [open, selectedSession, loadVols]);

  const addVol = async () => {
    if (!email.trim()) return;
    try {
      const res = await manageAttendanceVolunteers({ action: 'add', sessionId: selectedSession, userEmail: email.trim() });
      setVolunteers(res.volunteers);
      setEmail('');
      toast.success('Volunteer added!');
    } catch (e: any) { toast.error(e.message || 'Failed'); }
  };

  const removeVol = async (id: string) => {
    try {
      const res = await manageAttendanceVolunteers({ action: 'remove', sessionId: selectedSession, volunteerId: id });
      setVolunteers(res.volunteers);
      toast.success('Removed');
    } catch (e: any) { toast.error(e.message || 'Failed'); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-xs text-primary font-medium flex items-center gap-1"><Users className="w-3 h-3" /> Manage Volunteers</button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Manage Volunteer Access</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Session</Label>
            <select className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background mt-1" value={selectedSession} onChange={e => setSelectedSession(e.target.value)}>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Input placeholder="User email address" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addVol()} />
            <Button size="sm" onClick={addVol}>Add</Button>
          </div>
          <div className="space-y-2">
            {loading && <Skeleton className="h-8 w-full" />}
            {!loading && volunteers.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No volunteers assigned</p>}
            {volunteers.map(v => (
              <div key={v.id} className="flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm truncate">{v.userName || v.userEmail}</p>
                  {v.userName && <p className="text-xs text-muted-foreground truncate">{v.userEmail}</p>}
                </div>
                <button onClick={() => removeVol(v.id)} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
