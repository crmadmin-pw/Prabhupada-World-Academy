import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { bulkAddGroupMembers } from 'zite-endpoints-sdk';

type Member = { userId: string; fullName: string; ashrayLevel: string | null; existingGroup: { groupName: string } | null };

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  groupDbId: string;
  groupName: string;
  eligibleMembers: Member[];
}

export default function BvGroupAddMembersDialog({ open, onClose, onAdded, groupDbId, groupName, eligibleMembers }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() =>
    eligibleMembers.filter(m => m.fullName.toLowerCase().includes(search.toLowerCase())),
    [eligibleMembers, search]
  );

  const toggle = (userId: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(userId) ? next.delete(userId) : next.add(userId);
    return next;
  });

  const handleAdd = async () => {
    if (selected.size === 0) { toast.error('Select at least one member'); return; }
    setSaving(true);
    try {
      const result = await bulkAddGroupMembers({ groupDbId, userIds: [...selected] });
      toast.success(`Added ${result.added} member${result.added !== 1 ? 's' : ''}${result.alreadyMembers > 0 ? ` (${result.alreadyMembers} already in group)` : ''}`);
      setSelected(new Set()); setSearch('');
      onAdded();
    } catch { toast.error('Failed to add members'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Members to "{groupName}"</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <Input placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} />
          <p className="text-xs text-muted-foreground">{selected.size} selected · {filtered.length} shown</p>
          <div className="max-h-72 overflow-y-auto space-y-1 border rounded-md p-2">
            {filtered.length === 0 && <p className="text-sm text-center text-muted-foreground py-4">No eligible members found</p>}
            {filtered.map(m => (
              <div key={m.userId} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50">
                <Checkbox id={m.userId} checked={selected.has(m.userId)} onCheckedChange={() => toggle(m.userId)} />
                <label htmlFor={m.userId} className="flex-1 cursor-pointer">
                  <span className="text-sm font-medium">{m.fullName}</span>
                  {m.ashrayLevel && <span className="text-xs text-muted-foreground ml-1.5">{m.ashrayLevel}</span>}
                </label>
                {m.existingGroup && (
                  <Badge variant="secondary" className="text-[10px] shrink-0">{m.existingGroup.groupName}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} disabled={saving || selected.size === 0}>
            {saving ? 'Adding…' : `Add ${selected.size || ''} Members`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
