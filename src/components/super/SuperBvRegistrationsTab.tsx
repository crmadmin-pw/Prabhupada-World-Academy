import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Users, CheckCircle2, Clock, Leaf, Phone, HeartHandshake, BookOpen, Calendar, Building } from 'lucide-react';
import { getPendingBvRegistrations, approveAndAssignBvMember, getBvslGroups, rejectBvRegistration } from '@/lib/zite-endpoints-sdk';

export default function SuperBvRegistrationsTab() {
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedReg, setSelectedReg] = useState<any | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [regs, grpRes] = await Promise.all([
        getPendingBvRegistrations({}),
        getBvslGroups({ bvslId: 'ALL' }).catch(() => ({ groups: [] })),
      ]);
      setRegistrations(regs || []);
      setGroups(grpRes.groups || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load pending Bhakti Vriksha registrations');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (reg: any) => {
    if (!window.confirm(`Are you sure you want to reject the Bhakti Vriksha registration for ${reg.fullName}?`)) return;
    setRejectingId(reg.id);
    try {
      await rejectBvRegistration({ registrationId: reg.id });
      toast.success(`Rejected registration for ${reg.fullName}`);
      loadData();
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
      });
      toast.success(`Approved & assigned ${selectedReg.fullName} to Reading Group`);
      setSelectedReg(null);
      setTargetGroupId('');
      loadData();
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
                        if (groups.length > 0) setTargetGroupId(groups[0].id);
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

                  <div>
                    <span className="text-muted-foreground block">PW Classes:</span>
                    <span className="font-medium mt-0.5 block">{reg.pwClassesAttending || 'None'}</span>
                  </div>
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
        <Dialog open={!!selectedReg} onOpenChange={() => setSelectedReg(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Leaf className="w-5 h-5 text-primary" /> Approve & Assign Reading Group
              </DialogTitle>
              <DialogDescription>
                Assigning <strong>{selectedReg.fullName}</strong> to a Bhakti Vriksha Reading Group.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="bg-muted/50 p-3 rounded text-xs space-y-1">
                <p><strong>Applicant:</strong> {selectedReg.fullName} ({selectedReg.phoneCountryCode} {selectedReg.phone})</p>
                <p><strong>Preferred Time Slot:</strong> {selectedReg.timePreference}</p>
                <p><strong>Daily Chanting:</strong> {selectedReg.dailyChantingRounds} rounds</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold">Select Reading Group *</label>
                {groups.length === 0 ? (
                  <p className="text-xs text-destructive">No active Reading Groups found. Please create a group first.</p>
                ) : (
                  <Select value={targetGroupId} onValueChange={(val) => val && setTargetGroupId(val)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select group...">
                        {groups.find(g => g.id === targetGroupId || g.groupId === targetGroupId)
                          ? `${groups.find(g => g.id === targetGroupId || g.groupId === targetGroupId).groupName} (Facilitator: ${groups.find(g => g.id === targetGroupId || g.groupId === targetGroupId).bvslName || 'Unassigned'})`
                          : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map(g => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.groupName} (Facilitator: {g.bvslName || 'Unassigned'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedReg(null)}>Cancel</Button>
              <Button onClick={handleApprove} disabled={assigning || !targetGroupId}>
                {assigning && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Confirm Approval & Assign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
