import { useState, useEffect, useCallback } from 'react';
import { getBvslOneToOneData, saveBvslOneToOneLink } from 'zite-endpoints-sdk';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Link, Check, ChevronDown, ChevronUp, Info } from 'lucide-react';
import OneToOneMatrix from '@/components/guide/OneToOneMatrix';
import type { Member, Meeting } from '@/components/guide/OneToOneMatrix';
import OneToOneLogDialog from '@/components/guide/OneToOneLogDialog';

interface DialogState { open: boolean; memberId: string; memberName: string; weekDate: string; existing: Meeting | null; }

function BvslBookingLinkSettings({ initialLink }: { initialLink: string }) {
  const [link, setLink] = useState(initialLink);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { setLink(initialLink); }, [initialLink]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBvslOneToOneLink({ link });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Booking link saved! Your delegated members will see this link.');
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
          <p className="text-xs text-muted-foreground">
            Paste your Calendly or scheduling link. Members delegated to you will see this on their dashboard.
          </p>
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

export default function BvslOneToOneTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [bvslLink, setBvslLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogState>({ open: false, memberId: '', memberName: '', weekDate: '', existing: null });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBvslOneToOneData({}) as any;
      setMembers(res.users || []);
      setMeetings(res.meetings || []);
      setWeeks(res.weeks || []);
      if (res.bvslLink !== undefined) setBvslLink(res.bvslLink || '');
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openDialog = (memberId: string, memberName: string, weekDate: string, existing: Meeting | null) =>
    setDialog({ open: true, memberId, memberName, weekDate, existing });
  const closeDialog = () => setDialog(d => ({ ...d, open: false }));
  const onSaved = () => { closeDialog(); loadData(); };

  if (!loading && members.length === 0) {
    return (
      <div className="space-y-4">
        <BvslBookingLinkSettings initialLink={bvslLink} />
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Info className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm font-medium">No delegated members yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            When your guide delegates members to you for 1:1 meetings, they will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">My One-to-One Tracker</h2>
          <p className="text-sm text-muted-foreground">Members delegated to you for 1:1 meetings. Click any cell to log a meeting.</p>
        </div>
        <div className="shrink-0 sm:min-w-[260px]">
          <BvslBookingLinkSettings initialLink={bvslLink} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded bg-green-100 border border-green-300" /> Meeting logged</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-4 rounded border border-dashed border-border" /> No meeting</span>
            <span>Sorted by longest gap first</span>
          </div>
          <OneToOneMatrix
            members={members}
            meetings={meetings}
            weeks={weeks}
            groupByAshray={true}
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
      />
    </div>
  );
}
