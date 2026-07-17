import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Search, Phone, MessageCircle, ExternalLink, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { getBvslMembers, removeGroupMember } from 'zite-endpoints-sdk';
import type { GetBvslMembersOutputType } from 'zite-endpoints-sdk';
import { EmptyState, ConfirmDialog } from '@/shared';
import { ASHRAY_LEVELS } from '@/types/enums';
import { normalizePhoneForLinks } from '@/lib/userUtils';

type Member = GetBvslMembersOutputType['members'][0];

interface Props { bvslId: string; }

export default function BvslMembersTable({ bvslId }: Props) {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [residencyFilter, setResidencyFilter] = useState<'all' | 'residents' | 'non_residents'>('all');
  const [ashrayFilter, setAshrayFilter] = useState('all');
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => { if (bvslId) load(); }, [bvslId]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getBvslMembers({ bvslId } as any);
      setMembers(res.members);
    } catch { toast.error('Failed to load members'); }
    finally { setLoading(false); }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeGroupMember({
        groupId: (removeTarget as any).groupId || undefined,
        userId: removeTarget.userId,
      });
      toast.success(`${removeTarget.fullName} removed from group`);
      setRemoveTarget(null);
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove member');
    } finally {
      setRemoving(false);
    }
  };

  const distinctGroups = useMemo(() => {
    const seen = new Set<string>();
    const groups: string[] = [];
    members.forEach(m => { if (m.groupName && !seen.has(m.groupName)) { seen.add(m.groupName); groups.push(m.groupName); } });
    return groups;
  }, [members]);

  const filtered = useMemo(() => {
    let result = members;
    if (search) result = result.filter(m => m.fullName.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase()));
    if (groupFilter !== 'all') result = result.filter(m => m.groupName === groupFilter);
    if (residencyFilter === 'residents') result = result.filter(m => m.isResident);
    if (residencyFilter === 'non_residents') result = result.filter(m => !m.isResident);
    if (ashrayFilter !== 'all') result = result.filter(m => m.ashrayLevel === ashrayFilter);
    return result;
  }, [members, search, groupFilter, residencyFilter, ashrayFilter]);

  if (loading) return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-[300px] w-full" />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
            </div>
            {distinctGroups.length > 1 && (
              <div className="min-w-[140px]">
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="All Groups" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Groups</SelectItem>
                    {distinctGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="min-w-[140px]">
              <Select value={residencyFilter} onValueChange={(v: any) => setResidencyFilter(v)}>
                <SelectTrigger className="h-9">
                  {residencyFilter === 'all' ? 'All Members' : residencyFilter === 'residents' ? 'Residents' : 'Non-Residents'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  <SelectItem value="residents">Residents</SelectItem>
                  <SelectItem value="non_residents">Non-Residents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[130px]">
              <Select value={ashrayFilter} onValueChange={setAshrayFilter}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All Levels" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
              <Users className="w-4 h-4" />
              <span>{filtered.length} / {members.length} members</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {filtered.length === 0 ? (
            <EmptyState icon={Users} title={members.length === 0 ? 'No members in your groups yet.' : 'No members match your filters.'} />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="block md:hidden space-y-3">
                {filtered.map(m => (
                  <Card key={m.userId} className="hover:bg-accent">
                    <CardContent className="pt-4 pb-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 cursor-pointer" onClick={() => navigate(`/guide/users/${m.userId}`)}>
                          <p className="font-semibold text-sm truncate">{m.fullName}</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {m.groupName && <Badge variant="secondary" className="text-xs">{m.groupName}</Badge>}
                            {m.ashrayLevel && <Badge variant="outline" className="text-xs">{m.ashrayLevel}</Badge>}
                            {m.isResident && <Badge className="text-xs bg-primary/10 text-primary border-primary/30">{m.residencyName || 'Resident'}</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {m.phone && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0" asChild><a href={`tel:+${normalizePhoneForLinks(m.phone)}`}><Phone className="w-3.5 h-3.5" /></a></Button>
                              <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-green-500 text-green-700" asChild>
                                <a href={`https://wa.me/${normalizePhoneForLinks(m.phone)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="w-3.5 h-3.5" /></a>
                              </Button>
                            </>
                          )}
                          {(m as any).groupId && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => setRemoveTarget(m)}>
                              <UserMinus className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto overflow-y-auto max-h-[72vh]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium bg-card">Name</th>
                      <th className="text-left p-2 font-medium bg-card">Group</th>
                      <th className="text-left p-2 font-medium bg-card">Ashray Level</th>
                      <th className="text-left p-2 font-medium bg-card">Type</th>
                      <th className="text-left p-2 font-medium bg-card">Contact</th>
                      <th className="text-left p-2 font-medium bg-card">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(m => (
                      <tr
                        key={m.userId}
                        className="border-b hover:bg-accent cursor-pointer"
                        onClick={() => navigate(`/guide/users/${m.userId}`)}
                      >
                        <td className="p-2 font-medium">{m.fullName}</td>
                        <td className="p-2 text-muted-foreground">
                          {m.groupName ? <Badge variant="secondary" className="text-xs">{m.groupName}</Badge> : '—'}
                        </td>
                        <td className="p-2 text-muted-foreground">{m.ashrayLevel || '—'}</td>
                        <td className="p-2">
                          {m.isResident
                            ? <span className="text-primary font-medium text-xs">{m.residencyName || 'Resident'}</span>
                            : <span className="text-muted-foreground text-xs">Non-Resident</span>}
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            {m.phone && (
                              <>
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" asChild title="Call">
                                  <a href={`tel:+${normalizePhoneForLinks(m.phone)}`}><Phone className="w-3.5 h-3.5" /></a>
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0 border-green-500 text-green-700" asChild title="WhatsApp">
                                  <a href={`https://wa.me/${normalizePhoneForLinks(m.phone)}`} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="w-3.5 h-3.5" />
                                  </a>
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="View Profile"
                              onClick={() => navigate(`/guide/users/${m.userId}`)}>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          {(m as any).groupId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                              onClick={() => setRemoveTarget(m)}
                            >
                              <UserMinus className="w-3.5 h-3.5 mr-1" />Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={o => !o && setRemoveTarget(null)}
        title="Remove Member from Group"
        description={`Remove ${removeTarget?.fullName} from ${removeTarget?.groupName || 'the group'}? They can rejoin later if needed.`}
        confirmLabel={removing ? 'Removing…' : 'Remove'}
        variant="destructive"
        onConfirm={handleRemove}
      />
    </div>
  );
}
