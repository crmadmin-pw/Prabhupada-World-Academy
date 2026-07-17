import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Users, Trash2, UserPlus, UserMinus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getGuideGroups, createGroup, addGroupMember, removeGroupMember, GetGuideGroupsOutputType } from 'zite-endpoints-sdk';

interface GroupsTabProps {
  guideId: string;
}

type GroupType = GetGuideGroupsOutputType['groups'][0];

export default function GroupsTab({ guideId }: GroupsTabProps) {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupType[]>([]);
  const [availableUsers, setAvailableUsers] = useState<GetGuideGroupsOutputType['availableUsers']>([]);
  const [selectedGroup, setSelectedGroup] = useState<GroupType | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  // ISSUE-037 FIX: confirmation state for remove member
  const [removePending, setRemovePending] = useState<{ groupId: string; userId: string; userName: string } | null>(null);

  // Form state
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');

  useEffect(() => {
    loadData();
  }, [guideId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await getGuideGroups({ guideId });
      setGroups(result.groups);
      setAvailableUsers(result.availableUsers);
    } catch (error) {
      console.error('Failed to load groups:', error);
      toast.error('Failed to load groups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast.error('Group name is required');
      return;
    }

    try {
      await createGroup({
        groupName: newGroupName,
        description: newGroupDescription,
      });
      toast.success('Group created successfully!');
      setNewGroupName('');
      setNewGroupDescription('');
      setCreateDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to create group:', error);
      toast.error('Failed to create group');
    }
  };

  const handleAddMembers = async () => {
    if (!selectedGroup || selectedUserIds.size === 0) {
      toast.error('Please select users to add');
      return;
    }

    try {
      for (const userId of Array.from(selectedUserIds)) {
        await addGroupMember({
          groupId: selectedGroup.groupId,
          userId,
        });
      }
      toast.success(`Added ${selectedUserIds.size} member(s) to ${selectedGroup.groupName}`);
      setSelectedUserIds(new Set());
      setAddMemberDialogOpen(false);
      loadData();
    } catch (error) {
      console.error('Failed to add members:', error);
      toast.error('Failed to add members');
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string, userName: string) => {
    try {
      await removeGroupMember({ groupId, userId } as any);
      toast.success(`Removed ${userName} from group`);
      setRemovePending(null);
      loadData();
    } catch (error) {
      console.error('Failed to remove member:', error);
      toast.error('Failed to remove member');
    }
  };

  const toggleUserSelection = (userId: string) => {
    const newSelection = new Set(selectedUserIds);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUserIds(newSelection);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Groups Management</h2>
          <p className="text-muted-foreground">Create and manage user groups</p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Create Group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Group</DialogTitle>
              <DialogDescription>Add a new group to organize your users</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="groupName">Group Name</Label>
                <Input
                  id="groupName"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g., Residents, Brahmacharis"
                />
              </div>
              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder="Brief description of the group"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateGroup}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Groups List */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Groups Yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create your first group to organize users
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Group
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.groupId}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{group.groupName}</CardTitle>
                    {group.description && (
                      <CardDescription className="mt-1">{group.description}</CardDescription>
                    )}
                  </div>
                  <Badge variant="secondary">{group.memberCount} members</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Group Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-xs text-muted-foreground">Avg Score (7d)</div>
                    <div className="text-xl font-bold">{group.avgScore7d}</div>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-xs text-muted-foreground">Submission Rate</div>
                    <div className="text-xl font-bold">{Math.round(group.submissionRate7d * 100)}%</div>
                  </div>
                </div>

                {/* Members List */}
                {group.members.length > 0 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Members</Label>
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {group.members.map((member) => (
                        <div
                          key={member.userId}
                          className="flex items-center justify-between p-2 rounded hover:bg-muted"
                        >
                          <span className="text-sm">{member.fullName}</span>
                          {/* ISSUE-037 FIX: confirm before removing member */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemovePending({ groupId: group.groupId, userId: member.userId, userName: member.fullName })}
                          >
                            <UserMinus className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setSelectedGroup(group);
                      setAddMemberDialogOpen(true);
                    }}
                  >
                    <UserPlus className="w-3 h-3 mr-2" />
                    Add Members
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ISSUE-037 FIX: Remove Member Confirmation Dialog */}
      <AlertDialog open={!!removePending} onOpenChange={(open) => { if (!open) setRemovePending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <strong>{removePending?.userName}</strong> from this group? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => removePending && handleRemoveMember(removePending.groupId, removePending.userId, removePending.userName)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Members Dialog */}
      <Dialog open={addMemberDialogOpen} onOpenChange={setAddMemberDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Members to {selectedGroup?.groupName}</DialogTitle>
            <DialogDescription>Select users to add to this group</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {availableUsers
                  .filter(u => !selectedGroup?.members.some(m => m.userId === u.userId))
                  .map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUserIds.has(user.userId)}
                          onCheckedChange={() => toggleUserSelection(user.userId)}
                        />
                      </TableCell>
                      <TableCell>{user.fullName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{user.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setAddMemberDialogOpen(false);
              setSelectedUserIds(new Set());
            }}>
              Cancel
            </Button>
            <Button onClick={handleAddMembers} disabled={selectedUserIds.size === 0}>
              Add {selectedUserIds.size > 0 ? `(${selectedUserIds.size})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
