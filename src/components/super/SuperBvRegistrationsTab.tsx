import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Users, CheckCircle2, Clock, Leaf, Phone, HeartHandshake, BookOpen, Calendar, Building } from 'lucide-react';
import { getPendingBvRegistrations, approveAndAssignBvMember, getBvslGroups, getAllBvGroupsAdmin, rejectBvRegistration, getClientCachedQuery } from '@/lib/app-endpoints-sdk';
import { getBvGroupAssignmentOptions, isBvGroupActive, isBvGroupTimeMatch } from '@/lib/bvGroupAssignment';

const normalizeSegment = (value: unknown): 'PW' | 'FOLK' | undefined => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'FOLK') return 'FOLK';
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  return undefined;
};

export default function SuperBvRegistrationsTab({
  segment,
  guideId = '',
  isSuperGuide = false,
  onRegistrationResolved,
}: {
  segment?: 'PW' | 'FOLK';
  guideId?: string;
  isSuperGuide?: boolean;
  /** Updates the dashboard badge immediately after a successful decision. */
  onRegistrationResolved?: (registrationId: string) => void;
}) {
  const cachedRegs = getClientCachedQuery('getPendingBvRegistrations', { segment });
  const cachedGroups = getClientCachedQuery('getBvslGroups', { bvslId: 'ALL' });
  const hasCache = cachedRegs !== null && (isSuperGuide ? cachedGroups !== null : false);

  const [registrations, setRegistrations] = useState<any[]>(cachedRegs || []);
  const [allGroupsState, setAllGroupsState] = useState<any[]>(isSuperGuide ? (cachedGroups?.groups || []) : []);
  const [loading, setLoading] = useState(!hasCache);

  const [selectedReg, setSelectedReg] = useState<any | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = useState(false);
  // A realtime/background request can already be in flight when an approval
  // finishes. Keep successful decisions hidden until a fresh server response
  // confirms that the registration has left the pending queue.
  const resolvedRegistrationIdsRef = useRef<Set<string>>(new Set());

  // Start with the applicant's time-matched active group. The explicit
  // "Show all groups" control exposes every department group, including
  // inactive ones as disabled options so the list is complete without allowing
  // an accidental assignment to a disabled reading group.
  // Some older Super Guide-created groups do not carry complete segment
  // metadata, so applying the segment filter after this explicit action can
  // incorrectly hide otherwise valid groups from the dropdown.
  const assignmentOptions = {
    segment: selectedReg?.segment || segment,
    timePreference: selectedReg?.timePreference,
    showAllGroups,
  };
  const timeMatchedGroups = getBvGroupAssignmentOptions(allGroupsState, {
    ...assignmentOptions,
    showAllGroups: false,
  });
  const filteredGroups = getBvGroupAssignmentOptions(allGroupsState, assignmentOptions);

  useEffect(() => {
    if (!selectedReg) return;
    // A matching group always wins the initial selection. If none match, the
    // first group in the visible list is selected once all slots are shown.
    const preferredGroup = timeMatchedGroups[0] || filteredGroups.find(isBvGroupActive);
    if (preferredGroup) {
      setTargetGroupId(preferredGroup.id || preferredGroup.groupId || '');
    } else {
      setTargetGroupId('');
    }
  // Re-evaluate only as modal data, group data, or the all-slots toggle changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReg?.id, selectedReg?.timePreference, selectedReg?.segment, segment, showAllGroups, allGroupsState]);

  useEffect(() => { loadData(); }, [segment, guideId, isSuperGuide]);

  const loadData = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setLoading(true);
    try {
      const [, grpRes] = await Promise.all([
        read(() => getPendingBvRegistrations({ segment })).then(regs => {
          const fetchedRegistrations = Array.isArray(regs) ? regs : [];
          const fetchedIds = new Set(fetchedRegistrations.map(reg => String(reg.id)));
          for (const resolvedId of resolvedRegistrationIdsRef.current) {
            if (!fetchedIds.has(resolvedId)) resolvedRegistrationIdsRef.current.delete(resolvedId);
          }
          setRegistrations(fetchedRegistrations.filter(
            reg => !resolvedRegistrationIdsRef.current.has(String(reg.id)),
          ));
          setLoading(false);
          return regs;
        }),
        !isSuperGuide && guideId
          ? read(() => getAllBvGroupsAdmin({ guideId })).then((result: any) => ({
              groups: (result.groups || []).map((g: any) => ({
                ...g,
                id: g.groupDbId || g.groupId,
                groupId: g.groupId,
                bvslName: g.bvslName || g.bvslLeaderName || null,
                totalSessions: g.totalSessions ?? g.sessionCount ?? 0,
              })),
            }))
          : (isSuperGuide ? read(() => getBvslGroups({ bvslId: 'ALL' })) : Promise.resolve({ groups: [] }))
              .catch(() => ({ groups: [] })),
      ]);
      setAllGroupsState(grpRes.groups || []);
    } catch (err: any) {
      if (read.cancelled) return;
      toast.error(err?.message || 'Failed to load pending Bhakti Vriksha registrations');
    } finally {
      if (!silent && !read.cancelled) setLoading(false);
    }
  }, [segment, guideId, isSuperGuide]);


  const handleReject = async (reg: any) => {
    if (!window.confirm(`Are you sure you want to reject the Bhakti Vriksha registration for ${reg.fullName}?`)) return;
    setRejectingId(reg.id);
    try {
      await rejectBvRegistration({ registrationId: reg.id });
      // Do not wait for the Firestore invalidation round-trip before updating
      // this active queue. The realtime listener still reconciles this with
      // the server in the background for every open dashboard session.
      resolvedRegistrationIdsRef.current.add(String(reg.id));
      setRegistrations(current => current.filter(item => item.id !== reg.id));
      onRegistrationResolved?.(String(reg.id));
      toast.success(`Rejected registration for ${reg.fullName}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reject registration');
    } finally {
      setRejectingId(null);
    }
  };

  const handleApprove = async () => {
    if (!selectedReg || !targetGroupId) {
      toast.error('Please select a Reading Group to assign');
      return;
    }
    setAssigning(true);
    try {
      await approveAndAssignBvMember({
        registrationId: selectedReg.id,
        groupId: targetGroupId,
        segment: normalizeSegment(selectedReg.segment || segment),
      });
      resolvedRegistrationIdsRef.current.add(String(selectedReg.id));
      setRegistrations(current => current.filter(item => item.id !== selectedReg.id));
      onRegistrationResolved?.(String(selectedReg.id));
      toast.success(`Approved & assigned ${selectedReg.fullName} to Reading Group`);
      setSelectedReg(null);
      setTargetGroupId('');
      setShowAllGroups(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve registration');
    } finally {
      setAssigning(false);
    }
  };

  const handleApproveWithoutGroup = async () => {
    if (!selectedReg) return;
    setAssigning(true);
    try {
      await approveAndAssignBvMember({
        registrationId: selectedReg.id,
        segment: normalizeSegment(selectedReg.segment || segment),
      });
      resolvedRegistrationIdsRef.current.add(String(selectedReg.id));
      setRegistrations(current => current.filter(item => item.id !== selectedReg.id));
      onRegistrationResolved?.(String(selectedReg.id));
      toast.success(`Approved ${selectedReg.fullName}. Group assignment can be completed later.`);
      setSelectedReg(null);
      setTargetGroupId('');
      setShowAllGroups(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve registration');
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="text-sm text-muted-foreground">Loading pending Bhakti Vriksha registrations...</p>
      </div>
    );
  }

  const selectedGroup = allGroupsState.find(g => g.id === targetGroupId || g.groupId === targetGroupId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Leaf className="w-5 h-5 text-primary" /> Bhakti Vriksha Pending Registrations
          </h3>
          <p className="text-xs text-muted-foreground">
            Review new member applications, spiritual habits, time preferences, and assign them to a Reading Group.
          </p>
        </div>
        <Badge variant="outline" className="text-xs font-semibold">
          {registrations.length} Pending Approval
        </Badge>
      </div>

      {registrations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-green-500 opacity-80" />
            <p className="font-semibold text-base">All caught up!</p>
            <p className="text-xs">There are no pending Bhakti Vriksha member registrations right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {registrations.map(reg => (
            <Card key={reg.id} className="border-l-4 border-l-primary hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base text-foreground">{reg.fullName}</span>
                      <Badge className="bg-orange-500 text-white text-xs">Pending Approval</Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {reg.phoneE164 || `${reg.phoneCountryCode} ${reg.phone}`}
                      </span>
                    </div>
                    {reg.address && (
                      <p className="text-xs text-muted-foreground mt-0.5">📍 {reg.address}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => handleReject(reg)}
                      disabled={rejectingId === reg.id}
                    >
                      {rejectingId === reg.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      className="font-semibold shrink-0"
                      onClick={() => {
                        setSelectedReg(reg);
                        setShowAllGroups(false);
                        setTargetGroupId('');
                      }}
                    >
                      Approve & Assign Group
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t text-xs">
                  <div>
                    <span className="text-muted-foreground block">Time Slot Preference:</span>
                    <span className="font-medium text-primary flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" /> {reg.timePreference || 'Flexible'}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block">Daily Chanting:</span>
                    <span className="font-medium mt-0.5 block">{reg.dailyChantingRounds || 0} rounds / day</span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block">Ashraya Level:</span>
                    <span className="font-medium mt-0.5 block">{reg.ashrayLevel || 'None'}</span>
                  </div>

                  {segment !== 'FOLK' && (
                    <div>
                      <span className="text-muted-foreground block">PW Classes:</span>
                      <span className="font-medium mt-0.5 block">{reg.pwClassesAttending || 'None'}</span>
                    </div>
                  )}
                </div>

                {(reg.occupation || reg.companyName || reg.inTouchWithTemple) && (
                  <div className="bg-muted/40 p-2.5 rounded text-xs grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {reg.occupation && (
                      <div>
                        <span className="text-muted-foreground">Occupation: </span>
                        <span className="font-medium">{reg.occupation} {reg.companyName ? `(${reg.companyName})` : ''}</span>
                      </div>
                    )}
                    {reg.inTouchWithTemple && (
                      <div>
                        <span className="text-muted-foreground">Temple Contact: </span>
                        <span className="font-medium">{reg.templeName} {reg.devoteeName ? `(${reg.devoteeName})` : ''}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Assignment Modal */}
      {selectedReg && (
        <Dialog open={!!selectedReg} onOpenChange={() => {
          setSelectedReg(null);
          setShowAllGroups(false);
        }}>
          <DialogContent className="sm:max-w-lg min-w-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Leaf className="w-5 h-5 text-primary" /> Approve & Assign Reading Group
              </DialogTitle>
              <DialogDescription>
                Assigning <strong>{selectedReg.fullName}</strong> to a Bhakti Vriksha Reading Group.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 min-w-0">
              <div className="bg-muted/50 p-3 rounded text-xs space-y-1">
                <p><strong>Applicant:</strong> {selectedReg.fullName} ({selectedReg.phoneCountryCode} {selectedReg.phone})</p>
                <p><strong>Preferred Time Slot:</strong> {selectedReg.timePreference}</p>
                <p><strong>Daily Chanting:</strong> {selectedReg.dailyChantingRounds} rounds</p>
              </div>

              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <label className="text-sm font-semibold">Select Reading Group <span className="text-muted-foreground font-normal">(optional)</span></label>
                  {selectedReg.timePreference && selectedReg.timePreference !== 'Flexible' && (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showAllGroups}
                        onChange={(e) => setShowAllGroups(e.target.checked)}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span>Show all groups</span>
                    </label>
                  )}
                </div>

                {filteredGroups.length === 0 ? (
                  <div className="text-xs border border-amber-200 bg-amber-50/50 text-amber-800 rounded p-3 space-y-1.5">
                    <p>No active Reading Groups match this devotee's preferred time slot (<strong>{selectedReg.timePreference}</strong>).</p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllGroups(true);
                      }}
                      className="text-xs text-primary font-semibold underline hover:opacity-90 block"
                    >
                      Show all groups anyway
                    </button>
                  </div>
                ) : (
                  <>
                    <Select value={targetGroupId || undefined} onValueChange={(val: string | null) => val && setTargetGroupId(val)}>
                      <SelectTrigger className="w-full min-w-0 max-w-full overflow-hidden">
                        <SelectValue placeholder="Select group..." className="truncate min-w-0">
                          {selectedGroup
                            ? `${selectedGroup.groupName} (RGF: ${selectedGroup.bvslName || selectedGroup.bvslLeaderName || 'Unassigned'})`
                            : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="max-w-lg">
                        {filteredGroups.map(g => (
                          <SelectItem key={g.id} value={g.id} disabled={!isBvGroupActive(g)}>
                            {g.groupName} {g.meetingTime ? `[${g.meetingTime}]` : ''} (RGF: {g.bvslName || g.bvslLeaderName || 'Unassigned'}){!isBvGroupActive(g) ? ' — Inactive (activate before assigning)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Immediate Group & Facilitator Summary Display */}
                    {selectedGroup && (
                      <div className="bg-primary/5 border border-primary/20 p-3 rounded text-xs space-y-1 mt-2">
                        <p className="font-semibold text-primary">Selected Group Details:</p>
                        <p><strong>• Name of Reading Group:</strong> {selectedGroup.groupName}</p>
                        <p><strong>• RGF:</strong> {selectedGroup.bvslName || selectedGroup.bvslLeaderName || 'Unassigned'}</p>
                        <p><strong>• Meeting Time Slot:</strong> {selectedGroup.meetingTime || 'Flexible'}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <DialogFooter className="flex flex-wrap sm:flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setSelectedReg(null);
                setShowAllGroups(false);
              }}>Cancel</Button>
              <Button onClick={handleApprove} disabled={assigning || !targetGroupId} className="whitespace-nowrap">
                {assigning && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Confirm Approval & Assign
              </Button>
              <Button
                variant="outline"
                onClick={handleApproveWithoutGroup}
                disabled={assigning}
                className="whitespace-nowrap"
              >
                {assigning && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Approve Without Group
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
