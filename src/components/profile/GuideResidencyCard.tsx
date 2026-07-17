import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Home, Loader2, RefreshCw, User, CalendarDays, Clock, MapPin, ExternalLink, CalendarClock } from 'lucide-react';
import { leaveResidency, requestGuideTransfer, requestResidencyTransfer, setFolkCenter, getMyGuideOneToOne } from 'zite-endpoints-sdk';
import { differenceInDays, differenceInMonths, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import type { GetGuidesOutputType, GetAllResidenciesOutputType } from 'zite-endpoints-sdk';

interface Props {
  email: string;
  fullName: string;
  phone: string;
  guideName: string;
  currentGuideId: string | null;
  guides: GetGuidesOutputType['guides'];
  isResident: boolean;
  residencyName: string;
  residencyGuideVerified?: boolean;
  selectedFolkResidency: string | null;
  allResidencies: GetAllResidenciesOutputType;
  ashrayLevel?: string | null;
  residencyJoinDate?: string | null;
  onProfileChanged: () => void;
  hasPendingGuideTransfer?: boolean;
  hasPendingResidencyTransfer?: boolean;
  isPendingResidencyLeave?: boolean;
}

// ── Guide Transfer Dialog ──
function GuideTransferDialog({ email, currentGuideId, guides, onTransferred }: {
  email: string; currentGuideId: string | null; guides: GetGuidesOutputType['guides']; onTransferred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedGuideName, setSelectedGuideName] = useState('');
  const [loading, setLoading] = useState(false);
  const availableGuides = guides.filter((g: any) => g.guideId !== currentGuideId);

  const handleTransfer = async () => {
    if (!selectedGuideName) return;
    const targetGuide = availableGuides.find((g: any) => (g.name || g.abbr) === selectedGuideName);
    if (!targetGuide) return;
    setLoading(true);
    try {
      await requestGuideTransfer({ email, newGuideId: targetGuide.guideId } as any);
      toast.success('Guide transfer requested! Your status is now Pending Approval.');
      setOpen(false);
      onTransferred();
    } catch { toast.error('Failed to request guide transfer'); setLoading(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full"><RefreshCw className="w-4 h-4 mr-2" /> Request Guide Transfer</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Request Guide Transfer</AlertDialogTitle>
          <AlertDialogDescription>⚠️ Changing your guide will reset your status to <strong>Pending Approval</strong>.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Select value={selectedGuideName} onValueChange={(val) => setSelectedGuideName(val || '')}>
            <SelectTrigger><SelectValue placeholder="Select new guide" /></SelectTrigger>
            <SelectContent>
              {availableGuides.map((g: any) => (
                <SelectItem key={g.guideId} value={g.name || g.abbr}>
                  {g.name || g.abbr}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleTransfer} disabled={!selectedGuideName || loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Confirm Transfer
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Residency Transfer Dialog ──
function ResidencyTransferDialog({ email, currentResidencyId, residencies, onTransferred, buttonLabel, dialogTitle, dialogDesc, buttonVariant = "outline" }: {
  email: string; currentResidencyId: string | null; residencies: GetAllResidenciesOutputType; onTransferred: (id: string) => void;
  buttonLabel?: string; dialogTitle?: string; dialogDesc?: string; buttonVariant?: "outline" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [selectedResidencyName, setSelectedResidencyName] = useState('');
  const [loading, setLoading] = useState(false);
  const available = residencies.filter((r: any) => r.residencyId !== currentResidencyId);

  const handleTransfer = async () => {
    if (!selectedResidencyName) return;
    const targetResidency = available.find((r: any) => r.residencyName === selectedResidencyName);
    if (!targetResidency) return;
    setLoading(true);
    try {
      await requestResidencyTransfer({ email, newResidencyId: targetResidency.residencyId } as any);
      toast.success('Residency request sent! Awaiting guide verification.');
      setOpen(false);
      onTransferred(targetResidency.residencyId);
    } catch { toast.error('Failed to request residency change'); setLoading(false); }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={buttonVariant} size="sm" className="w-full"><Home className="w-4 h-4 mr-2" /> {buttonLabel || 'Change Folk Residency'}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle || 'Change Folk Residency'}</AlertDialogTitle>
          <AlertDialogDescription>{dialogDesc || 'Changing your residency requires re-verification by your guide.'}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <Select value={selectedResidencyName} onValueChange={(val) => setSelectedResidencyName(val || '')}>
            <SelectTrigger><SelectValue placeholder="Select residency" /></SelectTrigger>
            <SelectContent>
              {available.map((r: any) => (
                <SelectItem key={r.residencyId} value={r.residencyName}>
                  {r.residencyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleTransfer} disabled={!selectedResidencyName || loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Duration formatting — full year/month/day breakdown ──
function formatResidencyDuration(joinDate: string): string {
  try {
    const d = parseISO(joinDate);
    const now = new Date();
    const totalMonths = differenceInMonths(now, d);
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    // remaining days after full months
    const afterFullMonths = new Date(d);
    afterFullMonths.setMonth(afterFullMonths.getMonth() + totalMonths);
    const remainingDays = differenceInDays(now, afterFullMonths);
    const parts: string[] = [];
    if (years > 0) parts.push(`${years} year${years !== 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
    if (remainingDays > 0 || parts.length === 0) parts.push(`${remainingDays} day${remainingDays !== 1 ? 's' : ''}`);
    return parts.join(', ');
  } catch { return ''; }
}

// ── Set FOLK Center (inline, for users with no residency linked) ──
function SetFolkCenterSection({ allResidencies, onSaved }: {
  allResidencies: GetAllResidenciesOutputType; onSaved: () => void;
}) {
  const [selectedResidencyName, setSelectedResidencyName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedResidencyName) return;
    const targetResidency = allResidencies.find((r: any) => r.residencyName === selectedResidencyName);
    if (!targetResidency) return;
    setSaving(true);
    try {
      await setFolkCenter({ residencyId: targetResidency.residencyId });
      toast.success('FOLK center saved!');
      onSaved();
    } catch {
      toast.error('Failed to save FOLK center');
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
      <div className="flex items-center gap-2 text-amber-700 text-xs font-medium">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span>No FOLK center linked. Please select one.</span>
      </div>
      <Select value={selectedResidencyName} onValueChange={(val) => setSelectedResidencyName(val || '')}>
        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select FOLK center" /></SelectTrigger>
        <SelectContent>
          {allResidencies.map((r: any) => (
            <SelectItem key={r.residencyId} value={r.residencyName}>
              {r.residencyName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" className="w-full h-8" disabled={!selectedResidencyName || saving} onClick={handleSave}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}Save FOLK Center
      </Button>
    </div>
  );
}

// ── Last 1:1 Row (self-contained) ──
function LastOneToOneRow() {
  const [data, setData] = useState<{ guideName: string | null; guideLink: string | null; lastMeetingDate: string | null; lastMeetingWeeksAgo: number | null } | null>(null);

  useEffect(() => {
    getMyGuideOneToOne({}).then(r => setData(r as any)).catch(() => { });
  }, []);

  if (!data || !data.guideName) return null;

  const { guideLink, lastMeetingDate, lastMeetingWeeksAgo } = data;

  const urgencyColor = lastMeetingWeeksAgo === null
    ? 'text-destructive'
    : lastMeetingWeeksAgo <= 1 ? 'text-green-600'
      : lastMeetingWeeksAgo <= 2 ? 'text-amber-600'
        : 'text-destructive';

  let label = 'No 1:1 yet';
  if (lastMeetingDate && lastMeetingWeeksAgo !== null) {
    try {
      label = lastMeetingWeeksAgo === 0 ? 'This week' : lastMeetingWeeksAgo === 1 ? 'Last week'
        : `${format(parseISO(lastMeetingDate), 'MMM d')} (${lastMeetingWeeksAgo}w ago)`;
    } catch { label = `${lastMeetingWeeksAgo}w ago`; }
  }

  return (
    <div className="flex items-center gap-2 pl-6 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="w-3.5 h-3.5 shrink-0" />
        <span>Last 1:1:</span>
        <span className={`font-medium ${urgencyColor}`}>{label}</span>
      </div>
      <a
        href={guideLink || '#'}
        target={guideLink ? "_blank" : undefined}
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!guideLink) {
            e.preventDefault();
            toast.info('Booking link is not configured by your guide yet.');
          }
        }}
        className="text-primary hover:underline font-medium inline-flex items-center gap-0.5 ml-1"
      >
        <ExternalLink className="w-3.5 h-3.5" /> Book 1:1
      </a>
    </div>
  );
}

// ── Main Component ──
export default function GuideResidencyCard({
  email, fullName, phone, guideName, currentGuideId, guides,
  isResident, residencyName, residencyGuideVerified,
  selectedFolkResidency, allResidencies, residencyJoinDate,
  hasPendingGuideTransfer, hasPendingResidencyTransfer, isPendingResidencyLeave, onProfileChanged,
}: Props) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await leaveResidency({ email });
      toast.success('You are now a non-resident.');
      onProfileChanged();
    } catch { toast.error('Failed to update residency status'); }
    finally { setLeaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Guide and Residency</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <div className="space-y-4">
          {/* Folk Guide */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Folk Guide:</span>
              <span className="font-medium">{guideName || '—'}</span>
              {hasPendingGuideTransfer && (
                <Badge variant="secondary" className="ml-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]">
                  Pending Transfer
                </Badge>
              )}
            </div>
            <LastOneToOneRow />
            {hasPendingGuideTransfer ? (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2 text-xs text-amber-700 font-medium">
                ⏳ Guide transfer is pending approval.
              </div>
            ) : (
              <GuideTransferDialog email={email} currentGuideId={currentGuideId} guides={guides}
                onTransferred={() => navigate('/pending')} />
            )}
          </div>

          {/* Folk Residency */}
          <div className="space-y-2">
            {/* No center linked at all — show inline setup prompt */}
            {!selectedFolkResidency && allResidencies.length > 0 && (
              <SetFolkCenterSection allResidencies={allResidencies} onSaved={onProfileChanged} />
            )}
            {selectedFolkResidency && (
              <div className="flex items-center gap-2 flex-wrap">
                <Home className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Folk {isResident ? 'Residency' : 'Center'}:</span>
                <span className="font-medium">{residencyName || '—'}</span>
                {hasPendingResidencyTransfer && (
                  <Badge variant="secondary" className="ml-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]">
                    Pending Transfer
                  </Badge>
                )}
              </div>
            )}
            {!selectedFolkResidency && allResidencies.length === 0 && (
              <div className="flex items-center gap-2">
                <Home className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Folk Residency:</span>
                <span className="font-medium">{isResident ? (residencyName || '—') : 'Non-resident'}</span>
              </div>
            )}
            {isResident && residencyJoinDate && (
              <div className="pl-6 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  <span>Joined: <span className="font-medium text-foreground">{format(parseISO(residencyJoinDate), 'MMM d, yyyy')}</span></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Duration: <span className="font-medium text-foreground">{formatResidencyDuration(residencyJoinDate)}</span></span>
                </div>
              </div>
            )}
            {isResident && !residencyGuideVerified && !hasPendingResidencyTransfer && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Verification:</span>
                <Badge variant="secondary" className="text-xs">Pending</Badge>
              </div>
            )}
            {hasPendingResidencyTransfer ? (
              <div className="rounded-md border border-amber-200 bg-amber-50/50 p-2 text-xs text-amber-700 font-medium">
                {isPendingResidencyLeave
                  ? '⏳ Request to leave residency is pending approval.'
                  : '⏳ Residency transfer is pending approval.'}
              </div>
            ) : (
              <>
                {isResident && allResidencies.length > 0 && (
                  <ResidencyTransferDialog email={email} currentResidencyId={selectedFolkResidency}
                    residencies={allResidencies} onTransferred={() => onProfileChanged()} />
                )}
                {!isResident && selectedFolkResidency && allResidencies.length > 0 && (
                  <ResidencyTransferDialog
                    email={email}
                    currentResidencyId={null}
                    residencies={allResidencies}
                    onTransferred={() => onProfileChanged()}
                    buttonLabel="Request to Become Resident"
                    buttonVariant="outline"
                    dialogTitle="Request to Join a FOLK Residency"
                    dialogDesc="Your guide will review and approve your residency request."
                  />
                )}
              </>
            )}
            {isResident && !hasPendingResidencyTransfer && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full text-destructive border-destructive/40">
                    <Home className="w-4 h-4 mr-2" /> Leave FOLK Residency
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave FOLK Residency?</AlertDialogTitle>
                    <AlertDialogDescription>You will be removed from <strong>{residencyName}</strong> and become a non-resident.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleLeave} disabled={leaving}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {leaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}Confirm
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
