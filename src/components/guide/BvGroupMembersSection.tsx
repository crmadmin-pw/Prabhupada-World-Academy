import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserMinus, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { getGroupMembers, removeBvGroupMember } from 'zite-endpoints-sdk';

type Member = { membershipId: string; userId: string; fullName: string; phone: string; ashrayLevel: string | null; currentStreak: number; role: string; joinedAt: string | null };

interface Props {
  groupDbId: string;
  refreshKey: number;
  onMemberRemoved: () => void;
}

export default function BvGroupMembersSection({ groupDbId, refreshKey, onMemberRemoved }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getGroupMembers({ groupDbId })
      .then(res => setMembers((res as any).members))
      .catch(() => toast.error('Failed to load members'))
      .finally(() => setLoading(false));
  }, [groupDbId, refreshKey]);

  const handleRemove = async (m: Member) => {
    setRemoving(m.membershipId);
    try {
      await removeBvGroupMember({ membershipId: m.membershipId });
      toast.success(`${m.fullName} removed from group`);
      setMembers(prev => prev.filter(x => x.membershipId !== m.membershipId));
      onMemberRemoved();
    } catch { toast.error('Failed to remove member'); }
    finally { setRemoving(null); }
  };

  if (loading) return <div className="space-y-2 pt-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8" />)}</div>;
  if (members.length === 0) return <p className="text-sm text-muted-foreground pt-2 text-center py-4">No members yet. Click "Add Members" to get started.</p>;

  return (
    <div className="space-y-1 pt-2 border-t mt-2">
      {members.map(m => (
        <div key={m.membershipId} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/30">
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium">{m.fullName}</span>
            {m.ashrayLevel && <span className="text-xs text-muted-foreground ml-1.5">{m.ashrayLevel}</span>}
          </div>
          {m.currentStreak > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5 shrink-0">
              <Flame className="w-2.5 h-2.5 text-orange-500" />{m.currentStreak}d
            </Badge>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
            disabled={removing === m.membershipId} onClick={() => handleRemove(m)} title="Remove from group">
            <UserMinus className="w-3.5 h-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
