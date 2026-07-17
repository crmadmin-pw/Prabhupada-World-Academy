import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Users, Plus, Calendar, ChevronRight, Pencil, Trash2, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { createBvGroup, updateBvGroup, deleteBvGroup } from 'zite-endpoints-sdk';
import type { GetBvslGroupsOutputType } from 'zite-endpoints-sdk';

type Group = GetBvslGroupsOutputType['groups'][0];

interface Props {
  bvslId: string;
  groups: Group[];
  onGroupSelect: (groupId: string) => void;
  onRefresh: () => void;
}

function EditGroupDialog({ group, onSave }: { group: Group; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(group.groupName);
  const [desc, setDesc] = useState(group.description || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Group name is required'); return; }
    setSaving(true);
    try {
      await updateBvGroup({ groupId: group.groupId, groupName: name.trim(), description: desc.trim() });
      toast.success('Group updated!');
      setOpen(false);
      onSave();
    } catch { toast.error('Failed to update group'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => e.stopPropagation()}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent onClick={e => e.stopPropagation()}>
        <DialogHeader><DialogTitle>Edit Group</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-sm font-medium">Group Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" className="mt-1" />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupButton({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await deleteBvGroup({ groupId: group.groupId });
      toast.success('Group deleted');
      onDeleted();
    } catch { toast.error('Failed to delete group'); }
    finally { setDeleting(false); }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={e => e.stopPropagation()}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={e => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Group?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{group.groupName}</strong> and remove all its members. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? 'Deleting...' : 'Delete Group'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function BvslGroupsPanel({ bvslId, groups, onGroupSelect, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Group name is required'); return; }
    setCreating(true);
    try {
      await createBvGroup({ bvslId, groupName: name.trim(), description: desc.trim() });
      toast.success('Group created!');
      setOpen(false); setName(''); setDesc('');
      onRefresh();
    } catch { toast.error('Failed to create group'); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">My BV Groups</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" />New Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create BV Group</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <label className="text-sm font-medium">Group Name *</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monday Morning Group" className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" className="mt-1" />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? 'Creating...' : 'Create Group'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {groups.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>No groups yet. Create your first BV group.</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map(g => (
            <Card key={g.groupId} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onGroupSelect(g.groupId)}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex-1 min-w-0 truncate">{g.groupName}</CardTitle>
                  <div className="flex items-center gap-1 shrink-0">
                    <EditGroupDialog group={g} onSave={onRefresh} />
                    <DeleteGroupButton group={g} onDeleted={onRefresh} />
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
                {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-3 text-sm">
                  <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{g.memberCount} members</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{g.totalSessions} sessions</span>
                </div>
                {g.presentToday > 0 && (
                  <Badge className="mt-2 bg-green-500 text-xs">{g.presentToday} present today</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full h-7 text-xs border-green-500 text-green-700"
                  onClick={e => {
                    e.stopPropagation();
                    const joinUrl = g.joinToken
                      ? `${window.location.origin}/join-group?token=${g.joinToken}`
                      : window.location.origin;
                    const lines = [
                      `🙏 Hare Krishna!`,
                      ``,
                      `You are invited to join *${g.groupName}* — a Bhakti Vriksha group`,
                      g.bvslName ? `led by *${g.bvslName}*` : '',
                      g.guideName ? `under the guidance of *${g.guideName}*.` : '',
                      ``,
                      `Click to join: ${joinUrl}`,
                    ].filter(Boolean);
                    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
                  }}
                >
                  <MessageCircle className="w-3 h-3 mr-1" />WhatsApp Invite
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
