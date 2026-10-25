import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect, useCallback } from 'react';
import { getOneToOneMeetings, saveGuideOneToOneLink } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Link, Check, ChevronDown, ChevronUp, Settings2, Calendar, Clock, FileText, User } from 'lucide-react';
import OneToOneMatrix from './OneToOneMatrix';
import type { Member, Meeting } from './OneToOneMatrix';
import OneToOneLogDialog from './OneToOneLogDialog';
import EligibilityManageSheet from './EligibilityManageSheet';

interface GuideOption { guideId: string; guideName: string; }
interface Bvsl { userId: string; fullName: string; }
interface DialogState { open: boolean; memberId: string; memberName: string; weekDate: string; existing: Meeting | null; }
interface Props { guideId: string; }

const ASHRAY_LEVELS = ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha'];

function formatCallDate(dateStr: string | undefined): string {
  if (!dateStr) return 'No calls logged yet';
  const date = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? dateStr
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function BookingLinkSettings({ initialLink }: { initialLink: string }) {
  const [link, setLink] = useState(initialLink);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setLink(initialLink); }, [initialLink]);
  const handleSave = async () => {
    setSaving(true);
    try {
      await saveGuideOneToOneLink({ link });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Booking link saved!');
    } catch { toast.error('Failed to save link'); }
    finally { setSaving(false); }
  };
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full text-left">
        <Link className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Your 1:1 Booking Link</span>
        {initialLink && !open && <span className="text-xs text-green-600 font-medium ml-1">✓ Set</span>}
        <span className="ml-auto text-muted-foreground">{open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">Paste your Calendly or scheduling link — your members will see this and can book directly.</p>
          <div className="flex gap-2">
            <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://calendly.com/your-name/1-1" className="h-8 text-xs flex-1" />
            <Button size="sm" className="h-8 px-3 text-xs shrink-0" onClick={handleSave} disabled={saving || !link.trim()}>
              {saved ? <><Check className="h-3 w-3 mr-1" />Saved</> : saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OneToOneTab({ guideId }: Props) {
  const { profile } = useUserProfile();
  const isSuperGuide = profile?.role === 'SUPER_GUIDE';
  const normalizedSegment = String(profile?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const isFolk = normalizedSegment === 'FOLK';

  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [availableGuides, setAvailableGuides] = useState<GuideOption[]>([]);
  const [availableBvsls, setAvailableBvsls] = useState<Bvsl[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState(guideId);
  const [guideLink, setGuideLink] = useState('');
  const [loading, setLoading] = useState(true);

  // Filters
  const [ashrayFilter, setAshrayFilter] = useState('All');
  const [residencyFilter, setResidencyFilter] = useState(() => isFolk ? 'Residents' : 'All');

  // Dialogs
  const [dialog, setDialog] = useState<DialogState>({ open: false, memberId: '', memberName: '', weekDate: '', existing: null });
  const [eligibilityOpen, setEligibilityOpen] = useState(false);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, boolean>>({});

  const loadData = useReactiveLoader(async (read) => {
    !read.background && !read.cancelled && setLoading(true);
    try {
      const res = await read(() => getOneToOneMeetings({ guideId: selectedGuideId })) as any;
      !read.cancelled && setMembers(res.users || []);
      !read.cancelled && setMeetings(res.meetings || []);
      !read.cancelled && setWeeks(res.weeks || []);
      if (res.availableGuides?.length) !read.cancelled && setAvailableGuides(res.availableGuides);
      if (res.availableBvsls) !read.cancelled && setAvailableBvsls(res.availableBvsls);
      if (res.guideLink !== undefined) !read.cancelled && setGuideLink(res.guideLink || '');
    } catch {
      if (read.cancelled) return; /* silent */ }
    finally { !read.cancelled && setLoading(false); }
  }, [selectedGuideId]);

  useEffect(() => { loadData(); }, [loadData]);

  const openDialog = (memberId: string, memberName: string, weekDate: string, existing: Meeting | null) =>
    setDialog({ open: true, memberId, memberName, weekDate, existing });
  const closeDialog = () => setDialog(d => ({ ...d, open: false }));
  const onSaved = () => { closeDialog(); loadData(); };

  // Apply filters
  const filteredMembers = members.filter(m => {
    if (ashrayFilter !== 'All' && m.ashrayLevel !== ashrayFilter) return false;
    if (isFolk && residencyFilter === 'Residents' && !m.isResident) return false;
    if (isFolk && residencyFilter === 'Non-residents' && m.isResident) return false;
    return true;
  });

  const groupByAshray = ashrayFilter === 'All';

  const getMemberCallDetails = (memberId: string) => {
    const memberMeetings = meetings
      .filter(meeting => meeting.memberId === memberId)
      .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
    const latestWithNextCall = memberMeetings.find(meeting => meeting.nextCallDate);
    return {
      memberMeetings,
      lastCallDate: memberMeetings[0]?.meetingDate,
      nextCallDate: latestWithNextCall?.nextCallDate,
      nextCallAgenda: latestWithNextCall?.nextCallAgenda,
    };
  };

  return (
    <div className="space-y-4">
      <Toaster />

      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">One-to-One Tracker</h2>
          <p className="text-sm text-muted-foreground">Track weekly 1:1s with your members. Click any cell to log a meeting.</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end shrink-0 sm:min-w-[260px]">
          {isSuperGuide && availableGuides.length > 0 && (
            <Select value={selectedGuideId} onValueChange={(v) => setSelectedGuideId(v || '')}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Select a guide" />
              </SelectTrigger>
              <SelectContent>
                {availableGuides.map(g => (
                  <SelectItem key={g.guideId} value={g.guideId}>{g.guideName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!isSuperGuide && !profile?.isSadhanaMentor && <BookingLinkSettings initialLink={guideLink} />}
        </div>
      </div>

      {/* Filters + manage eligibility */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'All')}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Ashraya Level">
              {ashrayFilter === 'All' ? 'All Ashraya Levels' : ashrayFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Ashraya Levels</SelectItem>
            {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>

        {isFolk && (
          <Select value={residencyFilter} onValueChange={(v) => setResidencyFilter(v || 'All')}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="Residency">
                {residencyFilter === 'All' || residencyFilter === 'all' || residencyFilter === 'ALL' ? 'All Residencies' : residencyFilter}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Residencies</SelectItem>
              <SelectItem value="Residents">Residents</SelectItem>
              <SelectItem value="Non-residents">Non-residents</SelectItem>
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto">
          {!isSuperGuide && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setEligibilityOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
              Manage Eligibility
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-green-100 border border-green-300" /> Meeting logged</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded border border-dashed border-border" /> No meeting</span>
            {!profile?.isSadhanaMentor && availableBvsls.length > 0 && (
              <span className="text-blue-600">→ Name = Delegated</span>
            )}
            <span>{filteredMembers.length} of {members.length} members shown</span>
          </div>
          <OneToOneMatrix
            members={filteredMembers}
            meetings={meetings}
            weeks={weeks}
            groupByAshray={groupByAshray}
            onCellClick={openDialog}
          />

          <section className="mt-8 space-y-4">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Member Call Details & History ({filteredMembers.length})
            </h3>
            <div className="grid grid-cols-1 gap-4">
              {filteredMembers.map(member => {
                const { memberMeetings, lastCallDate, nextCallDate, nextCallAgenda } = getMemberCallDetails(member.userId);
                const isExpanded = !!expandedMembers[member.userId];
                return (
                  <Card key={member.userId} className="border border-border bg-card shadow-xs">
                    <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" /> {member.fullName}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {[member.ashrayLevel || 'No level', isFolk ? (member.isResident ? 'Resident' : 'Non-Resident') : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setExpandedMembers(current => ({ ...current, [member.userId]: !current[member.userId] }))}
                      >
                        {isExpanded ? <><ChevronUp className="w-4 h-4 mr-1" /> Hide history</> : <><ChevronDown className="w-4 h-4 mr-1" /> View history</>}
                      </Button>
                    </CardHeader>
                    <CardContent className="pt-0 pb-4 px-4 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-muted/30 p-2.5 rounded-md">
                        <div>
                          <span className="text-muted-foreground block font-medium">Last Call Logged</span>
                          <span className="font-semibold text-foreground flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3.5 h-3.5 text-primary" /> {formatCallDate(lastCallDate)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block font-medium">Next Call Agenda / Plan</span>
                          {nextCallDate ? (
                            <div className="mt-0.5">
                              <span className="font-semibold text-amber-600 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatCallDate(nextCallDate)}</span>
                              {nextCallAgenda && <p className="text-muted-foreground italic mt-0.5">{nextCallAgenda}</p>}
                            </div>
                          ) : <span className="text-muted-foreground italic mt-0.5 block">No upcoming call scheduled</span>}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pt-2 space-y-3 border-t border-border/60">
                          <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-muted-foreground" /> Call History Logs ({memberMeetings.length})
                          </h4>
                          {memberMeetings.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-2">No calls logged yet for this member.</p>
                          ) : (
                            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                              {memberMeetings.map(meeting => (
                                <div key={meeting.id} className="border border-border/80 rounded-md p-2.5 bg-background text-xs space-y-1.5">
                                  <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5">
                                    <span className="font-semibold text-foreground flex items-center gap-1"><Calendar className="w-3 h-3 text-muted-foreground" /> {formatCallDate(meeting.meetingDate)}</span>
                                    <span className="text-muted-foreground">{meeting.durationMinutes || 0} mins</span>
                                  </div>
                                  {meeting.callStatus && <span className="text-muted-foreground">Status: {meeting.callStatus}</span>}
                                  {meeting.notes && <p className="text-muted-foreground whitespace-pre-wrap">{meeting.notes}</p>}
                                  {meeting.nextCallDate && <p className="text-amber-700 font-medium">Next: {formatCallDate(meeting.nextCallDate)}{meeting.nextCallAgenda ? ` — ${meeting.nextCallAgenda}` : ''}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      )}

      <OneToOneLogDialog
        open={dialog.open}
        onClose={closeDialog}
        onSaved={onSaved}
        memberId={dialog.memberId}
        memberName={dialog.memberName}
        weekDate={dialog.weekDate}
        existing={dialog.existing as any}
        guideId={profile?.isSadhanaMentor ? guideId : undefined}
      />

      <EligibilityManageSheet
        open={eligibilityOpen}
        onClose={() => setEligibilityOpen(false)}
        onSaved={loadData}
        members={members}
        availableBvsls={availableBvsls}
      />
    </div>
  );
}
