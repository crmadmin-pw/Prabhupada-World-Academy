import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Home, Star, StarOff, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  getGuideUsers, getGuides, tagUserAsBvsl, assignGuide, tagUserAsFolkLead,
  tagUserAsTripCoordinator, tagUserAsBvMentor, tagUserAsSadhanaMentor, assignBvRole,
} from 'zite-endpoints-sdk';
import type { GetGuideUsersOutputType, GetGuidesOutputType } from 'zite-endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';
import { fmt } from '@/lib/fmt';
import { scoreColor } from '@/lib/scoring';
import { EmptyState, ConfirmDialog } from '@/shared';

type User = GetGuideUsersOutputType['users'][0] & { _guideId: string; _guideName: string };
type GuideEntry = GetGuidesOutputType['guides'][0];
type SortKey = 'fullName' | 'guideName' | 'ashrayLevel' | 'latestScore' | 'latestEntryDate' | 'isResident';
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 inline" />;
  return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 inline" /> : <ArrowDown className="w-3 h-3 ml-1 inline" />;
}

interface SuperUsersPanelProps {
  isPwAdmin?: boolean;
}

export default function SuperUsersPanel({ isPwAdmin = false }: SuperUsersPanelProps) {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [guides, setGuides] = useState<GuideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [guideFilter, setGuideFilter] = useState('all');
  const [ashrayFilter, setAshrayFilter] = useState('all');
  const [residentFilter, setResidentFilter] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('fullName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [bvslDialog, setBvslDialog] = useState<{ user: User; action: 'tag' | 'untag' } | null>(null);
  const [folkLeadDialog, setFolkLeadDialog] = useState<{ user: User; action: 'tag' | 'untag' } | null>(null);
  const [tripCoordDialog, setTripCoordDialog] = useState<{ user: User; action: 'tag' | 'untag' } | null>(null);
  const [bvMentorDialog, setBvMentorDialog] = useState<{ user: User; action: 'tag' | 'untag' } | null>(null);
  const [sadhanaMentorDialog, setSadhanaMentorDialog] = useState<{ user: User; action: 'tag' | 'untag' } | null>(null);
  const [bvRoleDialog, setBvRoleDialog] = useState<{ user: User; newRole: string; roleLabel: string } | null>(null);

  const ROLE_LABELS: Record<string, string> = {
    MEMBER: 'Regular Member',
    SUB_FACILITATOR: 'Sub-Facilitator (RGSF)',
    FACILITATOR: 'Facilitator (RGF)',
    SUPERVISOR: 'BV Supervisor',
    ADMIN: 'BV Admin',
  };
  const [bvMentorGuideId, setBvMentorGuideId] = useState('');
  const [assigningGuide, setAssigningGuide] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { guides: guideList } = await getGuides({});
      setGuides(guideList);
      const results = await Promise.all(
        guideList.map((g: any) =>
          getGuideUsers({ guideId: g.guideId, statusFilter: 'active' })
            .then((r: any) => r.users.map((u: any) => ({ ...u, _guideId: g.guideId, _guideName: g.name })))
            .catch(() => [] as User[])
        )
      );
      const seen = new Set<string>();
      const all: User[] = [];
      results.flat().forEach(u => { if (!seen.has(u.userId)) { seen.add(u.userId); all.push(u); } });
      setUsers(all);
    } catch { toast.error('Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleAssignGuide = async (userId: string, guideId: string) => {
    setAssigningGuide(userId);
    try {
      await assignGuide({ userId, guideId });
      const gName = guides.find(g => g.guideId === guideId)?.name || '';
      setUsers(prev => prev.map(u => u.userId === userId
        ? { ...u, selectedGuideId: guideId, _guideId: guideId, _guideName: gName }
        : u));
      toast.success('Guide assigned');
    } catch { toast.error('Failed to assign guide'); }
    finally { setAssigningGuide(null); }
  };

  const handleBvslAction = async () => {
    if (!bvslDialog) return;
    try {
      await tagUserAsBvsl({ userId: bvslDialog.user.userId, action: bvslDialog.action });
      toast.success(bvslDialog.action === 'tag' ? 'BVSL role assigned' : 'BVSL role removed');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update BVSL role');
    }
  };

  const handleFolkLeadAction = async () => {
    if (!folkLeadDialog) return;
    try {
      await tagUserAsFolkLead({ userId: folkLeadDialog.user.userId, action: folkLeadDialog.action });
      toast.success(folkLeadDialog.action === 'tag' ? 'FOLK Lead assigned' : 'FOLK Lead removed');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update FOLK Lead role');
    }
  };

  const handleTripCoordAction = async () => {
    if (!tripCoordDialog) return;
    try {
      await tagUserAsTripCoordinator({ userId: tripCoordDialog.user.userId, action: tripCoordDialog.action });
      toast.success(tripCoordDialog.action === 'tag' ? 'Trip Coordinator assigned' : 'Trip Coordinator removed');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update Trip Coordinator role');
    }
  };

  const handleSadhanaMentorAction = async () => {
    if (!sadhanaMentorDialog) return;
    try {
      await tagUserAsSadhanaMentor({ userId: sadhanaMentorDialog.user.userId, action: sadhanaMentorDialog.action });
      toast.success(sadhanaMentorDialog.action === 'tag' ? 'Sadhana Mentor assigned' : 'Sadhana Mentor removed');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update Sadhana Mentor role');
    }
  };

  const handleBvMentorAction = async () => {
    if (!bvMentorDialog) return;
    if (bvMentorDialog.action === 'tag' && !bvMentorGuideId) {
      toast.error('Please select a guide to assign');
      return;
    }
    try {
      await tagUserAsBvMentor({
        userId: bvMentorDialog.user.userId,
        action: bvMentorDialog.action,
        ...(bvMentorDialog.action === 'tag' ? { guideId: bvMentorGuideId } : {}),
      });
      toast.success(bvMentorDialog.action === 'tag' ? 'BV Mentor role assigned' : 'BV Mentor role removed');
      setBvMentorDialog(null);
      setBvMentorGuideId('');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update BV Mentor role');
    }
  };

  const handleAssignBvRole = async (userId: string, role: string) => {
    try {
      await assignBvRole({ userId, role: role as any });
      toast.success('Bhakti Vriksha role updated');
      loadData();
    } catch {
      toast.error('Failed to update role');
    }
  };

  const filtered = useMemo(() => {
    let r = users;
    if (guideFilter !== 'all') r = r.filter(u => u._guideId === guideFilter);
    if (ashrayFilter !== 'all') r = r.filter(u => u.ashrayLevel === ashrayFilter);
    if (!isPwAdmin) {
      if (residentFilter === 'residents') r = r.filter(u => u.residencyUserClaim && u.residencyGuideVerified);
      if (residentFilter === 'non_residents') r = r.filter(u => !(u.residencyUserClaim && u.residencyGuideVerified));
    }
    if (search) r = r.filter(u => u.fullName.toLowerCase().includes(search.toLowerCase()));
    return [...r].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'fullName') { av = a.fullName; bv = b.fullName; }
      else if (sortKey === 'guideName') { av = a._guideName; bv = b._guideName; }
      else if (sortKey === 'ashrayLevel') { av = a.ashrayLevel || ''; bv = b.ashrayLevel || ''; }
      else if (sortKey === 'latestScore') { av = a.latestScore ?? -1; bv = b.latestScore ?? -1; }
      else if (sortKey === 'latestEntryDate') { av = a.latestEntryDate || ''; bv = b.latestEntryDate || ''; }
      else if (sortKey === 'isResident') { av = (a.residencyUserClaim && a.residencyGuideVerified) ? 1 : 0; bv = (b.residencyUserClaim && b.residencyGuideVerified) ? 1 : 0; }
      else { av = ''; bv = ''; }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [users, guideFilter, ashrayFilter, residentFilter, search, sortKey, sortDir, isPwAdmin]);

  if (loading) return <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

  const Th = ({ col, label }: { col: SortKey; label: string }) => (
    <th className="text-left px-3 py-2 font-medium text-xs cursor-pointer select-none whitespace-nowrap hover:text-foreground bg-muted"
      onClick={() => handleSort(col)}>
      {label}<SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
    </th>
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Search by name..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <Select value={guideFilter} onValueChange={(v) => setGuideFilter(v || 'all')}>
                <SelectTrigger className="h-9 w-44 shrink-0"><SelectValue placeholder={isPwAdmin ? "All Mentors" : "All Guides"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{isPwAdmin ? "All Mentors" : "All Guides"}</SelectItem>
                  {guides.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'all')}>
                <SelectTrigger className="h-9 w-40 shrink-0"><SelectValue placeholder="All Levels" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              {!isPwAdmin && (
                <Select value={residentFilter} onValueChange={(v) => setResidentFilter(v || 'all')}>
                  <SelectTrigger className="h-9 w-40 shrink-0">
                    {residentFilter === 'all' ? 'All Users' : residentFilter === 'residents' ? 'Residents Only' : 'Non-Residents'}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="residents">Residents Only</SelectItem>
                    <SelectItem value="non_residents">Non-Residents</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{filtered.length} of {users.length} users shown</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto overflow-y-auto max-h-[72vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b">
                  <Th col="fullName" label="Name" />
                  <Th col="guideName" label={isPwAdmin ? "Mentor" : "Guide"} />
                  <Th col="ashrayLevel" label="Ashraya Level" />
                  <Th col="latestScore" label="Weekly Score" />
                  <Th col="latestEntryDate" label="Latest Entry" />
                  {!isPwAdmin && <Th col="isResident" label="Resident" />}
                  <th className="text-left px-3 py-2 font-medium text-xs bg-muted">{isPwAdmin ? "Assign Mentor" : "Assign Guide"}</th>
                  {isPwAdmin ? (
                    <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Bhakti Vriksha Role</th>
                  ) : (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">BVSL</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Sadhana Mentor</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">FOLK Lead</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Trip Coord.</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">BV Mentor</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isPwAdmin ? 7 : 12}>
                      <EmptyState icon={Users} title="No users found" description="Try adjusting your filters." />
                    </td></tr>
                ) : filtered.map(u => {
                  const isResident = !!(u.residencyUserClaim && u.residencyGuideVerified);
                  const currentBvRole = (u as any).isBvAdmin ? 'ADMIN' :
                    (u as any).isBvSupervisor ? 'SUPERVISOR' :
                    (u as any).isBvSubFacilitator ? 'SUB_FACILITATOR' :
                    ((u as any).isBvFacilitator || u.isBvsl || u.role === 'BVSL') ? 'FACILITATOR' :
                    'MEMBER';

                  return (
                    <tr key={u.userId} className="border-b hover:bg-accent/40 cursor-pointer"
                      onClick={() => navigate(`/guide/users/${u.userId}`)}>
                      <td className="px-3 py-2 font-medium">
                        {u.fullName}
                        {currentBvRole === 'SUPERVISOR' && <Badge className="ml-1 text-xs bg-amber-600">Supervisor</Badge>}
                        {currentBvRole === 'FACILITATOR' && <Badge className="ml-1 text-xs bg-purple-600">RGF</Badge>}
                        {currentBvRole === 'SUB_FACILITATOR' && <Badge className="ml-1 text-xs bg-blue-600">RGSF</Badge>}
                        {currentBvRole === 'ADMIN' && <Badge className="ml-1 text-xs bg-red-600">BV Admin</Badge>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{u._guideName}</td>
                      <td className="px-3 py-2 text-xs">{u.ashrayLevel || '—'}</td>
                      <td className="px-3 py-2">
                        {u.latestScore != null
                          ? <span className={`font-semibold ${scoreColor(u.latestScore, isResident)}`}>{u.latestScore}%</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{fmt.date(u.latestEntryDate)}</td>
                      {!isPwAdmin && (
                        <td className="px-3 py-2 text-center">
                          {isResident ? <Home className="w-4 h-4 text-primary inline" /> : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                      )}
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <Select value={u.selectedGuideId || u._guideId || ''} onValueChange={gid => handleAssignGuide(u.userId, gid)} disabled={assigningGuide === u.userId}>
                          <SelectTrigger className="h-7 text-xs w-36">
                            <SelectValue>
                              {guides.find(g => g.guideId === (u.selectedGuideId || u._guideId))?.name || (u.selectedGuideId || u._guideId)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {guides.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>

                      {isPwAdmin ? (
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <Select value={currentBvRole} onValueChange={r => setBvRoleDialog({ user: u, newRole: r, roleLabel: ROLE_LABELS[r] || r })}>
                            <SelectTrigger className="h-7 text-xs w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="min-w-[280px]">
                              <SelectItem value="MEMBER">Regular Member</SelectItem>
                              <SelectItem value="SUB_FACILITATOR">Sub-Facilitator (RGSF)</SelectItem>
                              <SelectItem value="FACILITATOR">Facilitator (RGF)</SelectItem>
                              <SelectItem value="SUPERVISOR">BV Supervisor</SelectItem>
                              <SelectItem value="ADMIN">BV Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u.isBvsl || u.role === 'BVSL') ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setBvslDialog({ user: u, action: (u.isBvsl || u.role === 'BVSL') ? 'untag' : 'tag' })}>
                              {(u.isBvsl || u.role === 'BVSL') ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setSadhanaMentorDialog({ user: u, action: (u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'untag' : 'tag' })}>
                              {(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u as any).isFolkLead ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setFolkLeadDialog({ user: u, action: (u as any).isFolkLead ? 'untag' : 'tag' })}>
                              {(u as any).isFolkLead ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u as any).isTripCoordinator ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setTripCoordDialog({ user: u, action: (u as any).isTripCoordinator ? 'untag' : 'tag' })}>
                              {(u as any).isTripCoordinator ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u as any).isBvMentor ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => { setBvMentorDialog({ user: u, action: (u as any).isBvMentor ? 'untag' : 'tag' }); setBvMentorGuideId(''); }}>
                              {(u as any).isBvMentor ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* BVSL Confirm — replaces AlertDialog block */}
      <ConfirmDialog
        open={!!bvslDialog}
        onOpenChange={o => !o && setBvslDialog(null)}
        title={bvslDialog?.action === 'tag' ? 'Assign BVSL Role' : 'Remove BVSL Role'}
        description={bvslDialog?.action === 'tag'
          ? `Assign ${bvslDialog?.user.fullName} as BVSL? They will gain access to the BVSL dashboard.`
          : `Remove BVSL role from ${bvslDialog?.user.fullName}?`}
        confirmLabel="Confirm"
        onConfirm={handleBvslAction}
      />
      <ConfirmDialog
        open={!!sadhanaMentorDialog}
        onOpenChange={o => !o && setSadhanaMentorDialog(null)}
        title={sadhanaMentorDialog?.action === 'tag' ? 'Assign Sadhana Mentor' : 'Remove Sadhana Mentor'}
        description={sadhanaMentorDialog?.action === 'tag'
          ? `Assign ${sadhanaMentorDialog?.user.fullName} as Sadhana Mentor? They will gain access to the Sadhana Mentor dashboard.`
          : `Remove Sadhana Mentor role from ${sadhanaMentorDialog?.user.fullName}?`}
        confirmLabel="Confirm"
        onConfirm={handleSadhanaMentorAction}
      />
      <ConfirmDialog
        open={!!folkLeadDialog}
        onOpenChange={o => !o && setFolkLeadDialog(null)}
        title={folkLeadDialog?.action === 'tag' ? 'Assign FOLK Lead' : 'Remove FOLK Lead'}
        description={folkLeadDialog?.action === 'tag'
          ? `Assign ${folkLeadDialog?.user.fullName} as FOLK Lead? They can manage rent payments for residents.`
          : `Remove FOLK Lead role from ${folkLeadDialog?.user.fullName}?`}
        confirmLabel="Confirm"
        onConfirm={handleFolkLeadAction}
      />
      <ConfirmDialog
        open={!!tripCoordDialog}
        onOpenChange={o => !o && setTripCoordDialog(null)}
        title={tripCoordDialog?.action === 'tag' ? 'Assign Trip Coordinator' : 'Remove Trip Coordinator'}
        description={tripCoordDialog?.action === 'tag'
          ? `Assign ${tripCoordDialog?.user.fullName} as Trip Coordinator? They can manage trip records and dues.`
          : `Remove Trip Coordinator role from ${tripCoordDialog?.user.fullName}?`}
        confirmLabel="Confirm"
        onConfirm={handleTripCoordAction}
      />

      {/* BV Mentor Dialog */}
      {bvMentorDialog && (
        <AlertDialog open onOpenChange={o => { if (!o) { setBvMentorDialog(null); setBvMentorGuideId(''); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {bvMentorDialog.action === 'tag' ? 'Assign BV Mentor Role' : 'Remove BV Mentor Role'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {bvMentorDialog.action === 'tag'
                  ? `${bvMentorDialog.user.fullName} will get access to the full BhaktiVriksha management dashboard. Select which guide's center they will manage.`
                  : `Remove BV Mentor role from ${bvMentorDialog.user.fullName}? They will lose access to the BV Mentor dashboard.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {bvMentorDialog.action === 'tag' && (
              <div className="py-2">
                <Select value={bvMentorGuideId} onValueChange={(v) => setBvMentorGuideId(v || '')}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="Select guide to assign…">
                      {guides.find(g => g.guideId === bvMentorGuideId)?.name || bvMentorGuideId}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {guides.map(g => (
                      <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBvMentorAction}
                className={bvMentorDialog.action === 'untag' ? 'bg-destructive hover:bg-destructive/90' : ''}
                disabled={bvMentorDialog.action === 'tag' && !bvMentorGuideId}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {bvRoleDialog && (
        <ConfirmDialog
          open={!!bvRoleDialog}
          onOpenChange={o => !o && setBvRoleDialog(null)}
          title="Confirm Role Assignment"
          description={`Are you sure you want to change ${bvRoleDialog.user.fullName}'s Bhakti Vriksha role to "${bvRoleDialog.roleLabel}"?`}
          confirmLabel="Confirm & Change Role"
          onConfirm={async () => {
            if (bvRoleDialog) {
              await handleAssignBvRole(bvRoleDialog.user.userId, bvRoleDialog.newRole);
              setBvRoleDialog(null);
            }
          }}
        />
      )}
    </>
  );
}
