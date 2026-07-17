import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Plus, ChevronDown, ChevronRight, UserPlus, MessageCircle, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getAllBvGroupsAdmin, getEligibleMembersForBvGroup, deleteBvGroup } from 'zite-endpoints-sdk';
import type { GetAllBvGroupsAdminOutputType } from 'zite-endpoints-sdk';
import BvGroupCreateDialog from './BvGroupCreateDialog';
import BvGroupAddMembersDialog from './BvGroupAddMembersDialog';
import BvGroupMembersSection from './BvGroupMembersSection';
import { ConfirmDialog } from '@/shared';

type Group = GetAllBvGroupsAdminOutputType['groups'][0];
type EligibleMember = { userId: string; fullName: string; phone: string; ashrayLevel: string | null; isBvsl: boolean; existingGroup: { groupId: string; groupName: string } | null };

interface Props { guideId: string; }

export default function BvGroupManagerPanel({ guideId }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [eligibleMembers, setEligibleMembers] = useState<EligibleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [addMembersGroup, setAddMembersGroup] = useState<Group | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [memberRefreshKeys, setMemberRefreshKeys] = useState<Record<string, number>>({});
  const [deleteGroupDialog, setDeleteGroupDialog] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { load(); }, [guideId]);

  const load = async () => {
    setLoading(true);
    try {
      const [adminRes, membersRes] = await Promise.all([
        getAllBvGroupsAdmin({ guideId }),
        getEligibleMembersForBvGroup({ guideId }),
      ]);
      setGroups(adminRes.groups);
      setEligibleMembers(membersRes.members);
    } catch { toast.error('Failed to load groups'); }
    finally { setLoading(false); }
  };

  const handleMemberAdded = (groupId: string) => {
    setMemberRefreshKeys(prev => ({ ...prev, [groupId]: (prev[groupId] || 0) + 1 }));
    setAddMembersGroup(null);
    load();
  };

  const handleDeleteGroup = async () => {
    if (!deleteGroupDialog) return;
    setDeleting(true);
    try {
      await deleteBvGroup({ groupId: deleteGroupDialog.groupId });
      toast.success(`"${deleteGroupDialog.groupName}" has been deleted`);
      setDeleteGroupDialog(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete group');
    } finally {
      setDeleting(false);
    }
  };

  const getFillColor = (rate: number) => rate >= 75 ? 'text-green-600' : rate >= 50 ? 'text-yellow-600' : 'text-destructive';

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{groups.length} group{groups.length !== 1 ? 's' : ''} · {eligibleMembers.length} eligible members</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" />Create Group</Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No BV groups yet</p>
          <p className="text-xs mt-1">Create a group and assign members on behalf of your BVSLs</p>
        </CardContent></Card>
      )}

      <div className="space-y-3">
        {groups.map(g => {
          const expanded = expandedGroupId === g.groupId;
          return (
            <Card key={g.groupId}>
              <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpandedGroupId(expanded ? null : g.groupId)}>
                <div className="flex items-center gap-2">
                  {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm truncate">{g.groupName}</CardTitle>
                    <p className="text-xs text-muted-foreground">{g.bvslName || 'No BVSL assigned'} · <span className="font-medium">{g.memberCount} members</span></p>
                  </div>
                  {g.avgAttendanceRate > 0 && <span className={`text-xs font-semibold shrink-0 ${getFillColor(g.avgAttendanceRate)}`}>{g.avgAttendanceRate}% att.</span>}
                  <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                      onClick={() => setAddMembersGroup(g)}>
                      <UserPlus className="w-3 h-3" />Add
                    </Button>
                    {g.joinToken && (
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                        title="WhatsApp Invite"
                        onClick={() => {
                          const url = `${window.location.origin}/join-group?token=${g.joinToken}`;
                          window.open(`https://wa.me/?text=${encodeURIComponent(`🙏 Hare Krishna!

Join *${g.groupName}*: ${url}`)}`, '_blank');
                        }}>
                        <MessageCircle className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete group"
                      onClick={() => setDeleteGroupDialog(g)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {expanded && (
                <CardContent className="pt-0">
                  <BvGroupMembersSection
                    groupDbId={g.groupId}
                    refreshKey={memberRefreshKeys[g.groupId] || 0}
                    onMemberRemoved={load}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <BvGroupCreateDialog open={createOpen} onClose={() => setCreateOpen(false)}
        onCreated={() => { setCreateOpen(false); load(); }} guideId={guideId} eligibleMembers={eligibleMembers} />

      {addMembersGroup && (
        <BvGroupAddMembersDialog open={!!addMembersGroup} onClose={() => setAddMembersGroup(null)}
          onAdded={() => handleMemberAdded(addMembersGroup.groupId)}
          groupDbId={addMembersGroup.groupId} groupName={addMembersGroup.groupName}
          eligibleMembers={eligibleMembers} />
      )}

      <ConfirmDialog
        open={!!deleteGroupDialog}
        onOpenChange={o => !o && setDeleteGroupDialog(null)}
        title="Delete Group"
        description={`Are you sure you want to delete "${deleteGroupDialog?.groupName}"? This will deactivate the group. Members will not be removed from the system.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Group'}
        onConfirm={handleDeleteGroup}
      />
    </div>
  );
}
