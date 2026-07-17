import { useState, useEffect, useCallback } from 'react';
import { getOneToOneMeetings, saveGuideOneToOneLink } from 'zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Link, Check, ChevronDown, ChevronUp, Settings2 } from 'lucide-react';
import OneToOneMatrix from './OneToOneMatrix';
import type { Member, Meeting } from './OneToOneMatrix';
import OneToOneLogDialog from './OneToOneLogDialog';
import EligibilityManageSheet from './EligibilityManageSheet';

interface GuideOption { guideId: string; guideName: string; }
interface Bvsl { userId: string; fullName: string; }
interface DialogState { open: boolean; memberId: string; memberName: string; weekDate: string; existing: Meeting | null; }
interface Props { guideId: string; }

const ASHRAY_LEVELS = ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha'];

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
  const [residencyFilter, setResidencyFilter] = useState('All');

  // Dialogs
  const [dialog, setDialog] = useState<DialogState>({ open: false, memberId: '', memberName: '', weekDate: '', existing: null });
  const [eligibilityOpen, setEligibilityOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOneToOneMeetings({ guideId: selectedGuideId }) as any;
      setMembers(res.users || []);
      setMeetings(res.meetings || []);
      setWeeks(res.weeks || []);
      if (res.availableGuides?.length) setAvailableGuides(res.availableGuides);
      if (res.availableBvsls) setAvailableBvsls(res.availableBvsls);
      if (res.guideLink !== undefined) setGuideLink(res.guideLink || '');
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [selectedGuideId]);

  useEffect(() => { loadData(); }, [loadData]);

  const openDialog = (memberId: string, memberName: string, weekDate: string, existing: Meeting | null) =>
    setDialog({ open: true, memberId, memberName, weekDate, existing });
  const closeDialog = () => setDialog(d => ({ ...d, open: false }));
  const onSaved = () => { closeDialog(); loadData(); };

  // Apply filters
  const filteredMembers = members.filter(m => {
    if (ashrayFilter !== 'All' && m.ashrayLevel !== ashrayFilter) return false;
    if (residencyFilter === 'Residents' && !m.isResident) return false;
    if (residencyFilter === 'Non-residents' && m.isResident) return false;
    return true;
  });

  const groupByAshray = ashrayFilter === 'All';

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

        <Select value={residencyFilter} onValueChange={(v) => setResidencyFilter(v || 'All')}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue placeholder="Residency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            <SelectItem value="Residents">Residents</SelectItem>
            <SelectItem value="Non-residents">Non-residents</SelectItem>
          </SelectContent>
        </Select>

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
            <span className="text-blue-600">→ Name = Delegated to BVSL</span>
            <span>{filteredMembers.length} of {members.length} members shown</span>
          </div>
          <OneToOneMatrix
            members={filteredMembers}
            meetings={meetings}
            weeks={weeks}
            groupByAshray={groupByAshray}
            onCellClick={openDialog}
          />
        </>
      )}

      <OneToOneLogDialog
        open={dialog.open}
        onClose={closeDialog}
        onSaved={onSaved}
        memberId={dialog.memberId}
        memberName={dialog.memberName}
        weekDate={dialog.weekDate}
        existing={dialog.existing}
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
