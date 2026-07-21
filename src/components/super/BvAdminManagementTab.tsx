import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, Plus, Users, ShieldCheck, UserCheck, Leaf, Clock, BookOpen } from 'lucide-react';
import { createBvGroup, assignBvRole, getBvslGroups, getGuides } from '@/lib/zite-endpoints-sdk';

export default function BvAdminManagementTab() {
  const [groups, setGroups] = useState<any[]>([]);
  const [guides, setGuides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Group creation modal state
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupBvslId, setNewGroupBvslId] = useState('');
  const [newGroupTime, setNewGroupTime] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Role assignment modal state
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'SUPERVISOR' | 'FACILITATOR' | 'SUB_FACILITATOR' | 'ADMIN' | 'MEMBER'>('FACILITATOR');
  const [assigningRole, setAssigningRole] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [grpRes, guideRes] = await Promise.all([
        getBvslGroups({ bvslId: 'ALL' }).catch(() => ({ groups: [] })),
        getGuides({}).catch(() => ({ guides: [] })),
      ]);
      setGroups(grpRes.groups || []);
      setGuides(guideRes.guides || []);
    } catch {
      toast.error('Failed to load BV management data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error('Please enter a group name');
      return;
    }
    setCreatingGroup(true);
    try {
      await createBvGroup({
        groupName: newGroupName.trim(),
        bvslId: newGroupBvslId,
        meetingTime: newGroupTime.trim() || undefined,
      });
      toast.success(`Created Reading Group "${newGroupName}"`);
      setCreateGroupOpen(false);
      setNewGroupName('');
      setNewGroupBvslId('');
      setNewGroupTime('');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create group');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleAssignRole = async () => {
    if (!targetUserId.trim()) {
      toast.error('Please enter a user ID or email');
      return;
    }
    setAssigningRole(true);
    try {
      const res = await assignBvRole({
        userId: targetUserId.trim(),
        role: selectedRole,
      });
      toast.success(res.message || 'Updated BV role successfully');
      setRoleModalOpen(false);
      setTargetUserId('');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign role');
    } finally {
      setAssigningRole(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
        <p className="text-sm text-muted-foreground">Loading BV Admin Management...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Bhakti Vriksha Admin Management
          </h3>
          <p className="text-xs text-muted-foreground">
            Create new Reading Groups and assign 5-tier BV hierarchy roles (Supervisor, Facilitator/RGF, Sub-Facilitator/RGSF).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setRoleModalOpen(true)} className="gap-1 text-xs">
            <UserCheck className="w-4 h-4" /> Assign Role
          </Button>
          <Button size="sm" onClick={() => setCreateGroupOpen(true)} className="gap-1 text-xs font-semibold">
            <Plus className="w-4 h-4" /> Create Reading Group
          </Button>
        </div>
      </div>

      {/* Active Reading Groups Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Leaf className="w-4 h-4 text-primary" /> Active Reading Groups ({groups.length})
          </CardTitle>
          <CardDescription className="text-xs">
            All active Bhakti Vriksha groups and their assigned Reading Group Facilitators (RGF).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground space-y-2">
              <Users className="w-10 h-10 mx-auto opacity-40" />
              <p>No active Reading Groups found.</p>
              <Button size="sm" variant="outline" onClick={() => setCreateGroupOpen(true)}>
                Create First Group
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map(g => (
                <Card key={g.id} className="border shadow-none hover:border-primary/40 transition-colors">
                  <CardContent className="pt-4 pb-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm text-foreground">{g.groupName}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Facilitator (RGF): <span className="font-medium text-foreground">{g.bvslName || 'Unassigned'}</span>
                        </p>
                      </div>
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        {g.memberCount || 0} Members
                      </Badge>
                    </div>
                    {g.meetingTime && (
                      <div className="bg-muted/40 p-2 rounded text-xs flex items-center gap-1 text-muted-foreground">
                        <Clock className="w-3.5 h-3.5 text-primary" /> {g.meetingTime}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Reading Group Modal */}
      <Dialog open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" /> Create New Reading Group
            </DialogTitle>
            <DialogDescription>
              Add a new Bhakti Vriksha reading group and assign a Reading Group Facilitator (RGF).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Group Name *</Label>
              <Input
                placeholder="e.g. Sri Chaitanya Reading Group"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Assign Facilitator (RGF) *</Label>
              <Select value={newGroupBvslId} onValueChange={(val: string) => setNewGroupBvslId(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facilitator..." />
                </SelectTrigger>
                <SelectContent>
                  {guides.map(g => (
                    <SelectItem key={g.guideId} value={g.guideId}>
                      {g.name || g.abbr} ({g.email || 'Guide'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Meeting Time Preference</Label>
              <Input
                placeholder="e.g. 7:45 PM – 8:15 PM (Everyday)"
                value={newGroupTime}
                onChange={e => setNewGroupTime(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateGroupOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateGroup} disabled={creatingGroup}>
              {creatingGroup && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Assignment Modal */}
      <Dialog open={roleModalOpen} onOpenChange={setRoleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-primary" /> Assign Bhakti Vriksha Role
            </DialogTitle>
            <DialogDescription>
              Assign a 5-tier role to a user (Supervisor, Facilitator/RGF, Sub-Facilitator/RGSF).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">User ID or Email *</Label>
              <Input
                placeholder="e.g. user@gmail.com or USER-001"
                value={targetUserId}
                onChange={e => setTargetUserId(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Select Role *</Label>
              <Select value={selectedRole} onValueChange={(val: any) => setSelectedRole(val)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-[360px] max-w-none">
                  <SelectItem value="SUPERVISOR">BV Supervisor (Oversees multiple RGFs)</SelectItem>
                  <SelectItem value="FACILITATOR">Reading Group Facilitator (RGF - Can view 1:1 reports)</SelectItem>
                  <SelectItem value="SUB_FACILITATOR">Reading Group Sub-Facilitator (RGSF - Group co-host)</SelectItem>
                  <SelectItem value="ADMIN">BV Admin</SelectItem>
                  <SelectItem value="MEMBER">Regular BV Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAssignRole} disabled={assigningRole}>
              {assigningRole && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Save Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
