import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import { createGroupForBvsl } from 'zite-endpoints-sdk';
import { ChevronsUpDown, Check, Search } from 'lucide-react';

type EligibleMember = { userId: string; fullName: string; ashrayLevel: string | null; isBvsl: boolean };

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  guideId: string;
  eligibleMembers: EligibleMember[];
}

export default function BvGroupCreateDialog({ open, onClose, onCreated, guideId, eligibleMembers }: Props) {
  const [bvslUserId, setBvslUserId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const sorted = useMemo(() => [...eligibleMembers].sort((a, b) => {
    if (a.isBvsl && !b.isBvsl) return -1;
    if (!a.isBvsl && b.isBvsl) return 1;
    return a.fullName.localeCompare(b.fullName);
  }), [eligibleMembers]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? sorted.filter(m => m.fullName.toLowerCase().includes(q)) : sorted;
  }, [sorted, searchQuery]);

  const selectedMember = eligibleMembers.find(m => m.userId === bvslUserId);

  const handleSelect = (userId: string) => {
    setBvslUserId(userId);
    setComboOpen(false);
    setSearchQuery('');
  };

  const handleCreate = async () => {
    if (!bvslUserId) { toast.error('Please select a BVSL leader'); return; }
    if (!groupName.trim()) { toast.error('Group name is required'); return; }
    setSaving(true);
    try {
      await createGroupForBvsl({ bvslUserId, guideId, groupName: groupName.trim(), description: description.trim() });
      toast.success(`Group "${groupName}" created!`);
      setGroupName(''); setDescription(''); setBvslUserId(''); setSearchQuery('');
      onCreated();
    } catch { toast.error('Failed to create group'); }
    finally { setSaving(false); }
  };

  const handleClose = () => {
    setGroupName(''); setDescription(''); setBvslUserId(''); setSearchQuery(''); setComboOpen(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create BV Group for BVSL</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">

          {/* Searchable BVSL Leader combobox */}
          <div>
            <label className="text-sm font-medium mb-1 block">Select BVSL Leader *</label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className={selectedMember ? 'text-foreground' : 'text-muted-foreground'}>
                    {selectedMember
                      ? `${selectedMember.fullName}${selectedMember.isBvsl ? ' ★' : ''}${selectedMember.ashrayLevel ? ` · ${selectedMember.ashrayLevel}` : ''}`
                      : 'Choose a person…'}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                {/* Search input */}
                <div className="flex items-center border-b px-3">
                  <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                    placeholder="Search by name…"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {/* Scrollable list */}
                <div className="max-h-60 overflow-y-auto py-1">
                  {filtered.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No members found</p>
                  ) : (
                    filtered.map(m => (
                      <button
                        key={m.userId}
                        onClick={() => handleSelect(m.userId)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors"
                      >
                        <Check className={`h-4 w-4 shrink-0 ${bvslUserId === m.userId ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                        <span className="flex-1 text-left">
                          {m.fullName}
                          {m.isBvsl && <span className="ml-1 text-primary">★</span>}
                          {m.ashrayLevel && <span className="ml-1 text-muted-foreground text-xs">· {m.ashrayLevel}</span>}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                {sorted.length > 0 && (
                  <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    ★ = already tagged as BVSL · selecting anyone auto-tags them
                  </p>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Group Name *</label>
            <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Monday Morning BV Group" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating…' : 'Create Group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
