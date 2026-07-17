import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { saveOneToOneEligibility } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';
import type { Member } from './OneToOneMatrix';

interface Bvsl { userId: string; fullName: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  members: Member[];
  availableBvsls: Bvsl[];
}

type EligibilityState = Record<string, { eligibility: string; delegateId: string }>;

const LEVELS = ['Jigyasa', 'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha'];

export default function EligibilityManageSheet({ open, onClose, onSaved, members, availableBvsls }: Props) {
  const [state, setState] = useState<EligibilityState>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const initial: EligibilityState = {};
      members.forEach(m => {
        initial[m.userId] = {
          eligibility: m.eligibility || 'Guide',
          delegateId: m.delegateId || '',
        };
      });
      setState(initial);
    }
  }, [open, members]);

  const setEligibility = (userId: string, eligibility: string) =>
    setState(s => ({ ...s, [userId]: { ...s[userId], eligibility } }));

  const setDelegate = (userId: string, delegateId: string) =>
    setState(s => ({ ...s, [userId]: { ...s[userId], delegateId } }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // Find changed records
      const changed = members.filter(m => {
        const curr = state[m.userId];
        return curr && (
          curr.eligibility !== (m.eligibility || 'Guide') ||
          curr.delegateId !== (m.delegateId || '')
        );
      });

      await Promise.all(changed.map(m => {
        const curr = state[m.userId];
        return saveOneToOneEligibility({
          userId: m.userId,
          eligibility: curr.eligibility as 'Guide' | 'Delegated' | 'Not Eligible',
          delegateId: curr.eligibility === 'Delegated' ? curr.delegateId : undefined,
        });
      }));

      toast.success(`Saved eligibility for ${changed.length} member${changed.length !== 1 ? 's' : ''}`);
      onSaved();
      onClose();
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // Group by ashray level
  const grouped: Record<string, Member[]> = {};
  const unknown: Member[] = [];
  members.forEach(m => {
    if (m.ashrayLevel && LEVELS.includes(m.ashrayLevel)) {
      grouped[m.ashrayLevel] = grouped[m.ashrayLevel] || [];
      grouped[m.ashrayLevel].push(m);
    } else {
      unknown.push(m);
    }
  });

  const renderGroup = (label: string, group: Member[]) => (
    <div key={label} className="space-y-1">
      <div className="flex items-center gap-2 px-1 py-1 sticky top-0 bg-background z-10">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 rounded-full">{group.length}</span>
      </div>
      {group.map(m => {
        const curr = state[m.userId] || { eligibility: 'Guide', delegateId: '' };
        return (
          <div key={m.userId} className="flex items-center gap-2 p-2 rounded-md border border-border bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{m.fullName}</p>
            </div>
            <Select value={curr.eligibility} onValueChange={v => setEligibility(m.userId, v)}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Guide">With Me</SelectItem>
                <SelectItem value="Delegated">Delegated</SelectItem>
                <SelectItem value="Not Eligible">Not Eligible</SelectItem>
              </SelectContent>
            </Select>
            {curr.eligibility === 'Delegated' && (
              <Select value={curr.delegateId || ''} onValueChange={v => setDelegate(m.userId, v)}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Pick BVSL" />
                </SelectTrigger>
                <SelectContent>
                  {availableBvsls.length === 0 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No BVSLs found</div>
                  )}
                  {availableBvsls.map(b => (
                    <SelectItem key={b.userId} value={b.userId}>{b.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {curr.eligibility !== 'Guide' && (
              <Badge
                variant={curr.eligibility === 'Delegated' ? 'secondary' : 'outline'}
                className={`text-[10px] shrink-0 ${curr.eligibility === 'Not Eligible' ? 'text-muted-foreground' : 'text-blue-700 bg-blue-50 border-blue-200'}`}
              >
                {curr.eligibility === 'Delegated'
                  ? (availableBvsls.find(b => b.userId === curr.delegateId)?.fullName?.split(' ')[0] || '?')
                  : '—'}
              </Badge>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Manage 1:1 Eligibility
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Set who each member does their 1:1 with. "With Me" = you; "Delegated" = a BVSL under you; "Not Eligible" = no 1:1 needed.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
          {LEVELS.map(lvl => grouped[lvl]?.length ? renderGroup(lvl, grouped[lvl]) : null)}
          {unknown.length > 0 && renderGroup('No Level', unknown)}
          {members.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No members found</p>
          )}
        </div>

        <div className="border-t border-border pt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</> : 'Save Changes'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
