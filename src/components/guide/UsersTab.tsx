import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  getGuideUsers, tagUserAsBvsl, tagUserAsSadhanaMentor, assignScholarStatus,
  getResidenciesForGuide, updateUserResidency, updateUserStatus,
  tagUserAsServiceAllocator, tagUserAsBvMentor, tagUserAsFolkLead,
  tagUserAsTripCoordinator, tagUserAsB, bulkUpdateUserFlags,
  retryTagMangoEnrollment, revoketagmangoaccess, toggleCleanlinessManager,
  GetGuideUsersOutputType,
} from 'zite-endpoints-sdk';
import { hasBvslRole, hasMentorRole, ASHRAY_LEVELS } from '@/types/enums';
import {
  Star, StarOff, GraduationCap, Users, BookOpen, Home, Globe,
  UserCheck, UserX, Settings2, ChevronRight, Wrench, Leaf, Crown,
  Map as MapIcon, RotateCw, ShieldOff, Sparkles,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { fmt } from '@/lib/fmt';
import { EmptyState, ConfirmDialog } from '@/shared';
import AshrayLevelDropdown from '@/components/guide/AshrayLevelDropdown';

type GuideUser = GetGuideUsersOutputType['users'][0];
type Residency = { id: string; residencyName: string };
interface UsersTabProps { guideId: string; }
type StatusFilter = 'active' | 'inactive' | 'all';
type RoleFilter = 'all' | 'bvsl' | 'mentor' | 'regular' | 'bv_mentor' | 'folk_lead' | 'trip_coordinator' | 'b' | 'other_center' | 'cleanliness_manager';

export default function UsersTab({ guideId }: UsersTabProps) {
  const navigate = useNavigate();

  // ── Data ─────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<GuideUser[]>([]);
  const [residencies, setResidencies] = useState<Residency[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [ashrayFilter, setAshrayFilter] = useState<string>('all');
  const [residencyFilter, setResidencyFilter] = useState<'all' | 'residents' | 'non_residents'>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [guideFilter, setGuideFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<{ flag: 'isB' | 'isOtherCenter'; value: boolean } | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Single-user dialogs ───────────────────────────────────────────────────
  const [bvslDialog, setBvslDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [mentorDialog, setMentorDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [scholarDialog, setScholarDialog] = useState<{ user: GuideUser; action: 'assign' | 'remove' } | null>(null);
  const [scholarResidencyId, setScholarResidencyId] = useState<string>('');
  const [serviceAllocatorDialog, setServiceAllocatorDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [bvMentorDialog, setBvMentorDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [folkLeadDialog, setFolkLeadDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [tripCoordinatorDialog, setTripCoordinatorDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [cmDialog, setCmDialog] = useState<{ user: GuideUser; action: 'tag' | 'untag' } | null>(null);
  const [bDialog, setBDialog] = useState<{ user: GuideUser; action: boolean } | null>(null);
  const [otherCenterDialog, setOtherCenterDialog] = useState<{ user: GuideUser; action: boolean } | null>(null);
  const [residencyDialog, setResidencyDialog] = useState<{ user: GuideUser; makeResident: boolean; residencyId?: string } | null>(null);
  const [statusDialog, setStatusDialog] = useState<{ user: GuideUser; newStatus: 'Active' | 'Inactive' } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [manageSheetUser, setManageSheetUser] = useState<GuideUser | null>(null);

  useEffect(() => { loadResidencies(); }, [guideId]);
  useEffect(() => { loadUsers(); }, [guideId, residencyFilter, statusFilter]);

  const loadResidencies = async () => {
    try {
      const res = await getResidenciesForGuide({ guideId });
      const resList = Array.isArray(res) ? res : [];
      setResidencies(resList.map((r: any) => ({ id: r.id, residencyName: r.residencyName || '' })));
      if (resList.length === 1) setScholarResidencyId(resList[0].id);
    } catch { /* non-critical */ }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await getGuideUsers({ guideId, statusFilter, residencyFilter });
      setUsers(result.users);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  // ── Action handlers ───────────────────────────────────────────────────────

  const handleBvslAction = async () => {
    if (!bvslDialog) return;
    try {
      await tagUserAsBvsl({ userId: bvslDialog.user.userId, action: bvslDialog.action });
      toast.success(bvslDialog.action === 'tag'
        ? `${bvslDialog.user.fullName} assigned as BVSL! Share: ${window.location.origin}/bvsl`
        : 'BVSL role removed', { duration: 8000 });
      setBvslDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update BVSL role'); }
  };

  const handleMentorAction = async () => {
    if (!mentorDialog) return;
    try {
      await tagUserAsSadhanaMentor({ userId: mentorDialog.user.userId, action: mentorDialog.action });
      toast.success(mentorDialog.action === 'tag' ? `${mentorDialog.user.fullName} assigned as Sadhana Mentor` : 'Sadhana Mentor role removed');
      setMentorDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Mentor role'); }
  };

  const handleServiceAllocatorAction = async () => {
    if (!serviceAllocatorDialog) return;
    try {
      await tagUserAsServiceAllocator({ userId: serviceAllocatorDialog.user.userId, action: serviceAllocatorDialog.action });
      toast.success(serviceAllocatorDialog.action === 'tag'
        ? `${serviceAllocatorDialog.user.fullName} assigned as Service Manager`
        : `Service Manager role removed from ${serviceAllocatorDialog.user.fullName}`);
      setServiceAllocatorDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Service Manager role'); }
  };

  const handleBvMentorAction = async () => {
    if (!bvMentorDialog) return;
    try {
      await tagUserAsBvMentor({ userId: bvMentorDialog.user.userId, action: bvMentorDialog.action });
      toast.success(bvMentorDialog.action === 'tag'
        ? `${bvMentorDialog.user.fullName} assigned as BV Mentor! They can now access the BV Mentor dashboard.`
        : `BV Mentor role removed from ${bvMentorDialog.user.fullName}`, { duration: 6000 });
      setBvMentorDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update BV Mentor role'); }
  };

  const handleFolkLeadAction = async () => {
    if (!folkLeadDialog) return;
    try {
      await tagUserAsFolkLead({ userId: folkLeadDialog.user.userId, action: folkLeadDialog.action });
      toast.success(folkLeadDialog.action === 'tag'
        ? `${folkLeadDialog.user.fullName} assigned as FOLK Lead`
        : `FOLK Lead role removed from ${folkLeadDialog.user.fullName}`);
      setFolkLeadDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update FOLK Lead role'); }
  };

  const handleTripCoordinatorAction = async () => {
    if (!tripCoordinatorDialog) return;
    try {
      await tagUserAsTripCoordinator({ userId: tripCoordinatorDialog.user.userId, action: tripCoordinatorDialog.action });
      toast.success(tripCoordinatorDialog.action === 'tag'
        ? `${tripCoordinatorDialog.user.fullName} assigned as Trip Coordinator`
        : `Trip Coordinator role removed from ${tripCoordinatorDialog.user.fullName}`);
      setTripCoordinatorDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Trip Coordinator role'); }
  };

  const handleCmAction = async () => {
    if (!cmDialog) return;
    try {
      await toggleCleanlinessManager({ userId: cmDialog.user.userId, isManager: cmDialog.action === 'tag' });
      toast.success(cmDialog.action === 'tag'
        ? `${cmDialog.user.fullName} appointed as Cleanliness Manager`
        : `Cleanliness Manager role removed from ${cmDialog.user.fullName}`);
      setCmDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Cleanliness Manager role'); }
  };

  const handleBAction = async () => {
    if (!bDialog) return;
    try {
      await tagUserAsB({ userId: bDialog.user.userId, isB: bDialog.action });
      toast.success(bDialog.action
        ? `${bDialog.user.fullName} marked as B`
        : `B status removed from ${bDialog.user.fullName}`);
      setBDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update B status'); }
  };

  const handleOtherCenterAction = async () => {
    if (!otherCenterDialog) return;
    try {
      await bulkUpdateUserFlags({ userIds: [otherCenterDialog.user.userId], flag: 'isOtherCenter', value: otherCenterDialog.action });
      toast.success(otherCenterDialog.action
        ? `${otherCenterDialog.user.fullName} marked as Other Center`
        : `Other Center removed from ${otherCenterDialog.user.fullName}`);
      setOtherCenterDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Other Center status'); }
  };

  const handleBulkAction = async () => {
    if (!bulkConfirm || selectedUserIds.size === 0) return;
    setBulkLoading(true);
    try {
      const result = await bulkUpdateUserFlags({
        userIds: Array.from(selectedUserIds),
        flag: bulkConfirm.flag,
        value: bulkConfirm.value,
      });
      const n = result.updated;
      const label = bulkConfirm.flag === 'isB'
        ? (bulkConfirm.value ? 'marked as B' : 'B status removed')
        : (bulkConfirm.value ? 'marked as Other Center' : 'Other Center removed');
      toast.success(`${n} user${n !== 1 ? 's' : ''} ${label}`);
      setBulkConfirm(null);
      setSelectedUserIds(new Set());
      loadUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Bulk action failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleScholarAction = async () => {
    if (!scholarDialog) return;
    const isAssign = scholarDialog.action === 'assign';
    const residencyId = isAssign ? (scholarResidencyId || (residencies[0]?.id ?? null)) : null;
    try {
      await assignScholarStatus({ userId: scholarDialog.user.userId, enabled: isAssign, residencyId });
      toast.success(isAssign
        ? `${scholarDialog.user.fullName} is now a Scholar at ${residencies.find(r => r.id === residencyId)?.residencyName || 'FOLK'}`
        : `Removed Scholar status from ${scholarDialog.user.fullName}`);
      setScholarDialog(null); loadUsers();
    } catch (err: any) { toast.error(err?.message || 'Failed to update Scholar status'); }
  };

  const handleResidencyAction = async () => {
    if (!residencyDialog) return;
    setActionLoading('residency');
    try {
      await updateUserResidency({
        userId: residencyDialog.user.userId,
        makeResident: residencyDialog.makeResident,
        residencyId: residencyDialog.residencyId || null,
      });
      toast.success(residencyDialog.makeResident
        ? `${residencyDialog.user.fullName} is now a FOLK Resident`
        : `${residencyDialog.user.fullName} changed to Non-Resident`);
      setResidencyDialog(null); loadUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update residency');
    } finally { setActionLoading(null); }
  };

  const handleStatusAction = async () => {
    if (!statusDialog) return;
    setActionLoading('status');
    try {
      await updateUserStatus({ userId: statusDialog.user.userId, status: statusDialog.newStatus });
      toast.success(statusDialog.newStatus === 'Inactive'
        ? `${statusDialog.user.fullName}'s account has been deactivated`
        : `${statusDialog.user.fullName}'s account has been re-activated`);
      setStatusDialog(null); loadUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update status');
    } finally { setActionLoading(null); }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  };

  // ── Memos ─────────────────────────────────────────────────────────────────
  const distinctGuides = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach(u => { if (u.selectedGuideId && u.selectedGuideName) map.set(u.selectedGuideId, u.selectedGuideName); });
    return Array.from(map.entries());
  }, [users]);

  const filteredUsers = useMemo(() => {
    let result = users;
    if (ashrayFilter !== 'all') result = result.filter(u => u.ashrayLevel === ashrayFilter);
    if (guideFilter !== 'all') result = result.filter(u => u.selectedGuideId === guideFilter);
    if (roleFilter === 'bvsl') result = result.filter(u => hasBvslRole(u.role, u.isBvsl));
    if (roleFilter === 'mentor') result = result.filter(u => hasMentorRole(u.role, u.isSadhanaMentor));
    if (roleFilter === 'regular') result = result.filter(u => !hasBvslRole(u.role, u.isBvsl) && !hasMentorRole(u.role, u.isSadhanaMentor));
    if (roleFilter === 'bv_mentor') result = result.filter(u => (u as any).isBvMentor);
    if (roleFilter === 'folk_lead') result = result.filter(u => (u as any).isFolkLead);
    if (roleFilter === 'trip_coordinator') result = result.filter(u => (u as any).isTripCoordinator);
    if (roleFilter === 'b') result = result.filter(u => (u as any).isB);
    if (roleFilter === 'other_center') result = result.filter(u => (u as any).isOtherCenter);
    if (roleFilter === 'cleanliness_manager') result = result.filter(u => (u as any).isCleanlinessManager);
    return result;
  }, [users, ashrayFilter, guideFilter, roleFilter]);

  const isAllSelected = filteredUsers.length > 0 && filteredUsers.every(u => selectedUserIds.has(u.userId));
  const isPartiallySelected = !isAllSelected && filteredUsers.some(u => selectedUserIds.has(u.userId));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        filteredUsers.forEach(u => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        filteredUsers.forEach(u => next.add(u.userId));
        return next;
      });
    }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading users...</div>;

  const selCount = selectedUserIds.size;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 mt-2 flex-wrap">
            <div className="flex-1 min-w-[130px]">
              <label className="text-sm font-medium mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={(v: StatusFilter) => setStatusFilter(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-sm font-medium mb-2 block">Ashray Level</label>
              <Select value={ashrayFilter} onValueChange={setAshrayFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Levels</SelectItem>
                  {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-sm font-medium mb-2 block">Residency</label>
              <Select value={residencyFilter} onValueChange={(v: any) => setResidencyFilter(v)}>
                <SelectTrigger>
                  {residencyFilter === 'all' ? 'All Users' : residencyFilter === 'residents' ? 'FOLK Residents' : 'Non-Residents'}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="residents">FOLK Residents</SelectItem>
                  <SelectItem value="non_residents">Non-Residents</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="text-sm font-medium mb-2 block">Role</label>
              <Select value={roleFilter} onValueChange={(v: any) => setRoleFilter(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="bvsl">BVSL Only</SelectItem>
                  <SelectItem value="mentor">Sadhana Mentor Only</SelectItem>
                  <SelectItem value="regular">Regular Users</SelectItem>
                  <SelectItem value="bv_mentor">BV Mentor</SelectItem>
                  <SelectItem value="folk_lead">FOLK Lead</SelectItem>
                  <SelectItem value="trip_coordinator">Trip Coordinator</SelectItem>
                  <SelectItem value="b">B's Only</SelectItem>
                  <SelectItem value="other_center">Other Center</SelectItem>
                  <SelectItem value="cleanliness_manager">Cleanliness Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {distinctGuides.length > 1 && (
              <div className="flex-1 min-w-[140px]">
                <label className="text-sm font-medium mb-2 block">Guide</label>
                <Select value={guideFilter} onValueChange={setGuideFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Guides</SelectItem>
                    {distinctGuides.map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className={selCount > 0 ? 'pb-24' : ''}>
          {/* TagMango enrollment stats */}
          <TagMangoEnrollmentStats users={filteredUsers} />

          {filteredUsers.length === 0 ? (
            <EmptyState icon={Users} title="No users found" description="Try adjusting your filters." />
          ) : (
            <>
              {/* ── Mobile ── */}
              <div className="block md:hidden space-y-3">
                {filteredUsers.map(user => (
                  <Card key={user.userId} className={user.status === 'INACTIVE' ? 'opacity-60' : ''}>
                    <CardContent className="pt-4 pb-3 space-y-3">
                      <div className="flex items-start gap-2">
                        <div className="pt-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedUserIds.has(user.userId)}
                            onCheckedChange={() => toggleUser(user.userId)}
                          />
                        </div>
                        <div className="flex-1 cursor-pointer" onClick={() => navigate(`/guide/users/${user.userId}`)}>
                          <div className="flex items-center gap-1">
                            <p className="font-semibold text-sm">{user.fullName}</p>
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {user.ashrayLevel || '—'}{user.selectedGuideName ? ` · ${user.selectedGuideName}` : ''}
                          </p>
                          <div className="flex gap-1 mt-1.5 flex-wrap">
                            {user.residencyApproved && <Badge variant="outline" className="text-xs border-primary text-primary py-0">🏠 Resident</Badge>}
                            {(user as any).isB && <Badge className="text-xs py-0 bg-yellow-500 text-yellow-950">B</Badge>}
                            {(user as any).isOtherCenter && <Badge className="text-xs py-0 bg-sky-500">Other Center</Badge>}
                            {hasBvslRole(user.role, user.isBvsl) && <Badge className="text-xs py-0 bg-purple-500">BVSL</Badge>}
                            {hasMentorRole(user.role, user.isSadhanaMentor) && <Badge className="text-xs py-0 bg-teal-600">Mentor</Badge>}
                            {(user as any).isBvMentor && <Badge className="text-xs py-0 bg-emerald-600">BV Mentor</Badge>}
                            {user.isScholar && <Badge className="text-xs py-0 bg-indigo-500">🎓 Scholar</Badge>}
                            {user.isServiceAllocator && <Badge className="text-xs py-0 bg-orange-500">Manager</Badge>}
                            {(user as any).isCleanlinessManager && <Badge className="text-xs py-0 bg-cyan-600">🧹 CM</Badge>}
                            {(user as any).isFolkLead && <Badge className="text-xs py-0 bg-blue-600">FOLK Lead</Badge>}
                            {(user as any).isTripCoordinator && <Badge className="text-xs py-0 bg-amber-600">Trip Coord</Badge>}
                            {user.status === 'INACTIVE' && <Badge variant="destructive" className="text-xs py-0">Inactive</Badge>}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="h-8 px-2.5 shrink-0"
                          onClick={e => { e.stopPropagation(); setManageSheetUser(user); }}>
                          <Settings2 className="w-3.5 h-3.5 mr-1" />Manage
                        </Button>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2">
                        <span>Entry: {fmt.dateShort(user.latestEntryDate)}</span>
                        <span>Score: {user.latestScore != null ? <span className="font-semibold text-primary">{user.latestScore}%</span> : '—'}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* ── Desktop ── */}
              <div className="hidden md:block overflow-x-auto overflow-y-auto max-h-[72vh]">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="p-2 bg-card w-8" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={isAllSelected || (isPartiallySelected ? 'indeterminate' : false)}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="text-left p-2 font-medium bg-card">Name</th>
                      <th className="text-left p-2 font-medium bg-card">Level</th>
                      <th className="text-left p-2 font-medium bg-card">Guide</th>
                      <th className="text-left p-2 font-medium bg-card">Sadhana Entry</th>
                      <th className="text-left p-2 font-medium bg-card">Score</th>
                      <th className="text-left p-2 font-medium bg-card">B</th>
                      <th className="text-left p-2 font-medium bg-card">Other Ctr</th>
                      <th className="text-left p-2 font-medium bg-card">Residency</th>
                      <th className="text-left p-2 font-medium bg-card">Account</th>
                      <th className="text-left p-2 font-medium bg-card">BVSL</th>
                      <th className="text-left p-2 font-medium bg-card">Mentor</th>
                      <th className="text-left p-2 font-medium bg-card">BV Mentor</th>
                      <th className="text-left p-2 font-medium bg-card">Scholar</th>
                      <th className="text-left p-2 font-medium bg-card">Manager</th>
                      <th className="text-left p-2 font-medium bg-card">FOLK Lead</th>
                      <th className="text-left p-2 font-medium bg-card">Trip Coord</th>
                      <th className="text-left p-2 font-medium bg-card">CM</th>
                      <th className="text-left p-2 font-medium bg-card">TagMango</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(user => (
                      <tr
                        key={user.userId}
                        className={`border-b hover:bg-accent cursor-pointer ${user.status === 'INACTIVE' ? 'opacity-60' : ''} ${selectedUserIds.has(user.userId) ? 'bg-accent/40' : ''}`}
                        onClick={() => navigate(`/guide/users/${user.userId}`)}
                      >
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedUserIds.has(user.userId)}
                            onCheckedChange={() => toggleUser(user.userId)}
                          />
                        </td>
                        <td className="p-2 font-medium">
                          {user.fullName}
                          {(user as any).isB && <Badge className="ml-1 bg-yellow-500 text-yellow-950 text-xs">B</Badge>}
                          {(user as any).isOtherCenter && <Badge className="ml-1 bg-sky-500 text-xs">Other Ctr</Badge>}
                          {hasBvslRole(user.role, user.isBvsl) && <Badge className="ml-1 bg-purple-500 text-xs">BVSL</Badge>}
                          {hasMentorRole(user.role, user.isSadhanaMentor) && <Badge className="ml-1 bg-teal-600 text-xs">Mentor</Badge>}
                          {(user as any).isBvMentor && <Badge className="ml-1 bg-emerald-600 text-xs">BV Mentor</Badge>}
                          {user.isScholar && <Badge className="ml-1 bg-indigo-500 text-xs">🎓</Badge>}
                          {user.isServiceAllocator && <Badge className="ml-1 bg-orange-500 text-xs">Manager</Badge>}
                          {(user as any).isCleanlinessManager && <Badge className="ml-1 bg-cyan-600 text-xs">🧹 CM</Badge>}
                          {(user as any).isFolkLead && <Badge className="ml-1 bg-blue-600 text-xs">FOLK Lead</Badge>}
                          {(user as any).isTripCoordinator && <Badge className="ml-1 bg-amber-600 text-xs">Trip Coord</Badge>}
                          {user.status === 'INACTIVE' && <Badge variant="destructive" className="ml-1 text-xs">Inactive</Badge>}
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <AshrayLevelDropdown userId={user.userId} currentLevel={user.ashrayLevel || 'Jigyasa'} onUpdated={loadUsers} compact />
                        </td>
                        <td className="p-2 text-sm text-muted-foreground">{user.selectedGuideName || '—'}</td>
                        <td className="p-2 text-sm text-muted-foreground">{fmt.date(user.latestEntryDate)}</td>
                        <td className="p-2">
                          {user.latestScore != null
                            ? <span className="font-semibold text-primary">{user.latestScore}%</span>
                            : '—'}
                        </td>

                        {/* B toggle */}
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm"
                            variant={(user as any).isB ? 'outline' : 'ghost'}
                            className={`h-7 text-xs ${(user as any).isB ? 'border-yellow-500 text-yellow-700' : ''}`}
                            onClick={() => setBDialog({ user, action: !(user as any).isB })}>
                            {(user as any).isB
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Star className="w-3 h-3 mr-1" />Mark B</>}
                          </Button>
                        </td>

                        {/* Other Center toggle */}
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm"
                            variant={(user as any).isOtherCenter ? 'outline' : 'ghost'}
                            className={`h-7 text-xs ${(user as any).isOtherCenter ? 'border-sky-500 text-sky-700' : ''}`}
                            onClick={() => setOtherCenterDialog({ user, action: !(user as any).isOtherCenter })}>
                            {(user as any).isOtherCenter
                              ? <><Globe className="w-3 h-3 mr-1" />Remove</>
                              : <><Globe className="w-3 h-3 mr-1" />Mark</>}
                          </Button>
                        </td>

                        {/* Residency toggle */}
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          {user.residencyApproved ? (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs border-primary text-primary hover:bg-primary/10"
                              onClick={() => setResidencyDialog({ user, makeResident: false })}>
                              <Home className="w-3 h-3 mr-1" />Resident → NR
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 text-xs"
                              onClick={() => setResidencyDialog({
                                user, makeResident: true,
                                residencyId: residencies.length === 1 ? residencies[0].id : undefined,
                              })}>
                              <Home className="w-3 h-3 mr-1" />NR → Resident
                            </Button>
                          )}
                        </td>

                        {/* Account toggle */}
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          {user.status === 'INACTIVE' ? (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs border-green-600 text-green-700 hover:bg-green-50"
                              onClick={() => setStatusDialog({ user, newStatus: 'Active' })}>
                              <UserCheck className="w-3 h-3 mr-1" />Activate
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => setStatusDialog({ user, newStatus: 'Inactive' })}>
                              <UserX className="w-3 h-3 mr-1" />Deactivate
                            </Button>
                          )}
                        </td>

                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={hasBvslRole(user.role, user.isBvsl) ? 'outline' : 'ghost'}
                            className={hasBvslRole(user.role, user.isBvsl) ? 'border-purple-500 text-purple-700' : ''}
                            onClick={() => setBvslDialog({ user, action: hasBvslRole(user.role, user.isBvsl) ? 'untag' : 'tag' })}>
                            {hasBvslRole(user.role, user.isBvsl)
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Star className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={hasMentorRole(user.role, user.isSadhanaMentor) ? 'outline' : 'ghost'}
                            className={hasMentorRole(user.role, user.isSadhanaMentor) ? 'border-teal-500 text-teal-700' : ''}
                            onClick={() => setMentorDialog({ user, action: hasMentorRole(user.role, user.isSadhanaMentor) ? 'untag' : 'tag' })}>
                            {hasMentorRole(user.role, user.isSadhanaMentor)
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><GraduationCap className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={(user as any).isBvMentor ? 'outline' : 'ghost'}
                            className={(user as any).isBvMentor ? 'border-emerald-500 text-emerald-700' : ''}
                            onClick={() => setBvMentorDialog({ user, action: (user as any).isBvMentor ? 'untag' : 'tag' })}>
                            {(user as any).isBvMentor
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Leaf className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          {!user.residencyApproved ? (
                            <Button size="sm" variant={user.isScholar ? 'outline' : 'ghost'}
                              className={user.isScholar ? 'border-indigo-500 text-indigo-700' : ''}
                              onClick={() => { if (residencies.length === 1) setScholarResidencyId(residencies[0].id); setScholarDialog({ user, action: user.isScholar ? 'remove' : 'assign' }); }}>
                              {user.isScholar
                                ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                                : <><BookOpen className="w-3 h-3 mr-1" />Assign</>}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground/40">Resident</span>
                          )}
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={user.isServiceAllocator ? 'outline' : 'ghost'}
                            className={user.isServiceAllocator ? 'border-orange-500 text-orange-700' : ''}
                            onClick={() => setServiceAllocatorDialog({ user, action: user.isServiceAllocator ? 'untag' : 'tag' })}>
                            {user.isServiceAllocator
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Wrench className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={(user as any).isFolkLead ? 'outline' : 'ghost'}
                            className={(user as any).isFolkLead ? 'border-blue-500 text-blue-700' : ''}
                            onClick={() => setFolkLeadDialog({ user, action: (user as any).isFolkLead ? 'untag' : 'tag' })}>
                            {(user as any).isFolkLead
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Crown className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={(user as any).isTripCoordinator ? 'outline' : 'ghost'}
                            className={(user as any).isTripCoordinator ? 'border-amber-500 text-amber-700' : ''}
                            onClick={() => setTripCoordinatorDialog({ user, action: (user as any).isTripCoordinator ? 'untag' : 'tag' })}>
                            {(user as any).isTripCoordinator
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><MapIcon className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant={(user as any).isCleanlinessManager ? 'outline' : 'ghost'}
                            className={(user as any).isCleanlinessManager ? 'border-cyan-500 text-cyan-700' : ''}
                            onClick={() => setCmDialog({ user, action: (user as any).isCleanlinessManager ? 'untag' : 'tag' })}>
                            {(user as any).isCleanlinessManager
                              ? <><StarOff className="w-3 h-3 mr-1" />Remove</>
                              : <><Sparkles className="w-3 h-3 mr-1" />Assign</>}
                          </Button>
                        </td>
                        <td className="p-2" onClick={e => e.stopPropagation()}>
                          <TagMangoBadge user={user} />
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

      {/* ── Floating Bulk Action Bar ── */}
      {selCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-2xl">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-sm font-semibold px-3 py-1 shrink-0">
              {selCount} selected
            </Badge>
            <Button size="sm" variant="outline" className="border-yellow-500 text-yellow-700 h-8"
              onClick={() => setBulkConfirm({ flag: 'isB', value: true })}>
              <Star className="w-3.5 h-3.5 mr-1" />Mark as B
            </Button>
            <Button size="sm" variant="outline" className="h-8"
              onClick={() => setBulkConfirm({ flag: 'isB', value: false })}>
              <StarOff className="w-3.5 h-3.5 mr-1" />Remove B
            </Button>
            <Button size="sm" variant="outline" className="border-sky-500 text-sky-700 h-8"
              onClick={() => setBulkConfirm({ flag: 'isOtherCenter', value: true })}>
              <Globe className="w-3.5 h-3.5 mr-1" />Other Center
            </Button>
            <Button size="sm" variant="outline" className="h-8"
              onClick={() => setBulkConfirm({ flag: 'isOtherCenter', value: false })}>
              <Globe className="w-3.5 h-3.5 mr-1" />Remove OC
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground ml-auto"
              onClick={() => setSelectedUserIds(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* ── Mobile Manage Sheet ── */}
      <Sheet open={!!manageSheetUser} onOpenChange={o => !o && setManageSheetUser(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85dvh] overflow-y-auto pb-safe">
          {manageSheetUser && (() => {
            const u = manageSheetUser;
            const isBvsl = hasBvslRole(u.role, u.isBvsl);
            const isMentor = hasMentorRole(u.role, u.isSadhanaMentor);
            const closeSheet = () => setManageSheetUser(null);
            return (
              <>
                <SheetHeader className="text-left pb-2">
                  <SheetTitle className="text-base">{u.fullName}</SheetTitle>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span className="text-xs text-muted-foreground">{u.ashrayLevel || '—'}</span>
                    {u.residencyApproved && <Badge variant="outline" className="text-xs border-primary text-primary py-0">🏠 Resident</Badge>}
                    {(u as any).isB && <Badge className="text-xs py-0 bg-yellow-500 text-yellow-950">B</Badge>}
                    {(u as any).isOtherCenter && <Badge className="text-xs py-0 bg-sky-500">Other Center</Badge>}
                    {isBvsl && <Badge className="text-xs py-0 bg-purple-500">BVSL</Badge>}
                    {isMentor && <Badge className="text-xs py-0 bg-teal-600">Mentor</Badge>}
                    {(u as any).isBvMentor && <Badge className="text-xs py-0 bg-emerald-600">BV Mentor</Badge>}
                    {u.isScholar && <Badge className="text-xs py-0 bg-indigo-500">🎓 Scholar</Badge>}
                    {u.isServiceAllocator && <Badge className="text-xs py-0 bg-orange-500">Manager</Badge>}
                    {(u as any).isCleanlinessManager && <Badge className="text-xs py-0 bg-cyan-600">🧹 CM</Badge>}
                    {(u as any).isFolkLead && <Badge className="text-xs py-0 bg-blue-600">FOLK Lead</Badge>}
                    {(u as any).isTripCoordinator && <Badge className="text-xs py-0 bg-amber-600">Trip Coord</Badge>}
                    {u.status === 'INACTIVE' && <Badge variant="destructive" className="text-xs py-0">Inactive</Badge>}
                  </div>
                </SheetHeader>

                <div className="space-y-2 mt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Ashray Level</p>
                  <div className="px-1">
                    <AshrayLevelDropdown userId={u.userId} currentLevel={u.ashrayLevel || 'Jigyasa'} onUpdated={() => { closeSheet(); loadUsers(); }} />
                  </div>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Residency</p>
                  {u.residencyApproved ? (
                    <Button variant="outline" className="w-full justify-start h-11 border-primary/40 text-primary"
                      onClick={() => { closeSheet(); setResidencyDialog({ user: u, makeResident: false }); }}>
                      <Home className="w-4 h-4 mr-2" />Change to Non-Resident
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full justify-start h-11"
                      onClick={() => { closeSheet(); setResidencyDialog({ user: u, makeResident: true, residencyId: residencies.length === 1 ? residencies[0].id : undefined }); }}>
                      <Home className="w-4 h-4 mr-2" />Make FOLK Resident
                    </Button>
                  )}

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">BVSL Role</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${isBvsl ? 'border-purple-400 text-purple-700' : ''}`}
                    onClick={() => { closeSheet(); setBvslDialog({ user: u, action: isBvsl ? 'untag' : 'tag' }); }}>
                    {isBvsl ? <><StarOff className="w-4 h-4 mr-2" />Remove BVSL Role</> : <><Star className="w-4 h-4 mr-2" />Assign as BVSL</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Sadhana Mentor</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${isMentor ? 'border-teal-400 text-teal-700' : ''}`}
                    onClick={() => { closeSheet(); setMentorDialog({ user: u, action: isMentor ? 'untag' : 'tag' }); }}>
                    {isMentor ? <><StarOff className="w-4 h-4 mr-2" />Remove Mentor Role</> : <><GraduationCap className="w-4 h-4 mr-2" />Assign as Sadhana Mentor</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">BV Mentor</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isBvMentor ? 'border-emerald-400 text-emerald-700' : ''}`}
                    onClick={() => { closeSheet(); setBvMentorDialog({ user: u, action: (u as any).isBvMentor ? 'untag' : 'tag' }); }}>
                    {(u as any).isBvMentor ? <><StarOff className="w-4 h-4 mr-2" />Remove BV Mentor Role</> : <><Leaf className="w-4 h-4 mr-2" />Assign as BV Mentor</>}
                  </Button>

                  {!u.residencyApproved && (
                    <>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Scholar</p>
                      <Button variant="outline" className={`w-full justify-start h-11 ${u.isScholar ? 'border-indigo-400 text-indigo-700' : ''}`}
                        onClick={() => { closeSheet(); if (residencies.length === 1) setScholarResidencyId(residencies[0].id); setScholarDialog({ user: u, action: u.isScholar ? 'remove' : 'assign' }); }}>
                        {u.isScholar ? <><StarOff className="w-4 h-4 mr-2" />Remove Scholar Status</> : <><BookOpen className="w-4 h-4 mr-2" />Assign Scholar Status</>}
                      </Button>
                    </>
                  )}

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">B Status</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isB ? 'border-yellow-500 text-yellow-700' : ''}`}
                    onClick={() => { closeSheet(); setBDialog({ user: u, action: !(u as any).isB }); }}>
                    {(u as any).isB ? <><StarOff className="w-4 h-4 mr-2" />Remove B Status</> : <><Star className="w-4 h-4 mr-2" />Mark as B</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Other Center</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isOtherCenter ? 'border-sky-500 text-sky-700' : ''}`}
                    onClick={() => { closeSheet(); setOtherCenterDialog({ user: u, action: !(u as any).isOtherCenter }); }}>
                    {(u as any).isOtherCenter ? <><Globe className="w-4 h-4 mr-2" />Remove Other Center</> : <><Globe className="w-4 h-4 mr-2" />Mark as Other Center</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Service Manager</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${u.isServiceAllocator ? 'border-orange-400 text-orange-700' : ''}`}
                    onClick={() => { closeSheet(); setServiceAllocatorDialog({ user: u, action: u.isServiceAllocator ? 'untag' : 'tag' }); }}>
                    {u.isServiceAllocator ? <><StarOff className="w-4 h-4 mr-2" />Remove Service Manager Role</> : <><Wrench className="w-4 h-4 mr-2" />Assign as Service Manager</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">FOLK Lead</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isFolkLead ? 'border-blue-400 text-blue-700' : ''}`}
                    onClick={() => { closeSheet(); setFolkLeadDialog({ user: u, action: (u as any).isFolkLead ? 'untag' : 'tag' }); }}>
                    {(u as any).isFolkLead ? <><StarOff className="w-4 h-4 mr-2" />Remove FOLK Lead Role</> : <><Crown className="w-4 h-4 mr-2" />Assign as FOLK Lead</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Trip Coordinator</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isTripCoordinator ? 'border-amber-400 text-amber-700' : ''}`}
                    onClick={() => { closeSheet(); setTripCoordinatorDialog({ user: u, action: (u as any).isTripCoordinator ? 'untag' : 'tag' }); }}>
                    {(u as any).isTripCoordinator ? <><StarOff className="w-4 h-4 mr-2" />Remove Trip Coordinator Role</> : <><MapIcon className="w-4 h-4 mr-2" />Assign as Trip Coordinator</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Cleanliness Manager</p>
                  <Button variant="outline" className={`w-full justify-start h-11 ${(u as any).isCleanlinessManager ? 'border-cyan-400 text-cyan-700' : ''}`}
                    onClick={() => { closeSheet(); setCmDialog({ user: u, action: (u as any).isCleanlinessManager ? 'untag' : 'tag' }); }}>
                    {(u as any).isCleanlinessManager ? <><StarOff className="w-4 h-4 mr-2" />Remove Cleanliness Manager Role</> : <><Sparkles className="w-4 h-4 mr-2" />Assign as Cleanliness Manager</>}
                  </Button>

                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pt-2">Account</p>
                  {u.status === 'INACTIVE' ? (
                    <Button variant="outline" className="w-full justify-start h-11 border-green-500 text-green-700"
                      onClick={() => { closeSheet(); setStatusDialog({ user: u, newStatus: 'Active' }); }}>
                      <UserCheck className="w-4 h-4 mr-2" />Re-activate Account
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full justify-start h-11 border-destructive/40 text-destructive"
                      onClick={() => { closeSheet(); setStatusDialog({ user: u, newStatus: 'Inactive' }); }}>
                      <UserX className="w-4 h-4 mr-2" />Deactivate Account
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* ── Confirm Dialogs ── */}
      <ConfirmDialog open={!!bvslDialog} onOpenChange={o => !o && setBvslDialog(null)}
        title={bvslDialog?.action === 'tag' ? 'Assign BVSL Role' : 'Remove BVSL Role'}
        description={bvslDialog?.action === 'tag'
          ? `Assign ${bvslDialog?.user.fullName} as a BVSL? They will gain access to the BVSL dashboard.`
          : `Remove BVSL role from ${bvslDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleBvslAction} />

      <ConfirmDialog open={!!mentorDialog} onOpenChange={o => !o && setMentorDialog(null)}
        title={mentorDialog?.action === 'tag' ? 'Assign Sadhana Mentor Role' : 'Remove Sadhana Mentor Role'}
        description={mentorDialog?.action === 'tag'
          ? `Assign ${mentorDialog?.user.fullName} as a Sadhana Mentor?`
          : `Remove the Sadhana Mentor role from ${mentorDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleMentorAction} />

      <ConfirmDialog open={!!serviceAllocatorDialog} onOpenChange={o => !o && setServiceAllocatorDialog(null)}
        title={serviceAllocatorDialog?.action === 'tag' ? 'Assign Service Manager Role' : 'Remove Service Manager Role'}
        description={serviceAllocatorDialog?.action === 'tag'
          ? `Assign ${serviceAllocatorDialog?.user.fullName} as a Service Manager? They will gain access to FOLK Services allocation and management.`
          : `Remove the Service Manager role from ${serviceAllocatorDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleServiceAllocatorAction} />

      <ConfirmDialog open={!!bvMentorDialog} onOpenChange={o => !o && setBvMentorDialog(null)}
        title={bvMentorDialog?.action === 'tag' ? 'Assign BV Mentor Role' : 'Remove BV Mentor Role'}
        description={bvMentorDialog?.action === 'tag'
          ? `Assign ${bvMentorDialog?.user.fullName} as a BV Mentor? They will get access to a dedicated BV Mentor dashboard.`
          : `Remove BV Mentor role from ${bvMentorDialog?.user.fullName}? They will lose access to the BV Mentor dashboard.`}
        confirmLabel="Confirm" onConfirm={handleBvMentorAction} />

      <ConfirmDialog open={!!folkLeadDialog} onOpenChange={o => !o && setFolkLeadDialog(null)}
        title={folkLeadDialog?.action === 'tag' ? 'Assign FOLK Lead Role' : 'Remove FOLK Lead Role'}
        description={folkLeadDialog?.action === 'tag'
          ? `Assign ${folkLeadDialog?.user.fullName} as a FOLK Lead?`
          : `Remove the FOLK Lead role from ${folkLeadDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleFolkLeadAction} />

      <ConfirmDialog open={!!tripCoordinatorDialog} onOpenChange={o => !o && setTripCoordinatorDialog(null)}
        title={tripCoordinatorDialog?.action === 'tag' ? 'Assign Trip Coordinator Role' : 'Remove Trip Coordinator Role'}
        description={tripCoordinatorDialog?.action === 'tag'
          ? `Assign ${tripCoordinatorDialog?.user.fullName} as a Trip Coordinator?`
          : `Remove the Trip Coordinator role from ${tripCoordinatorDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleTripCoordinatorAction} />

      <ConfirmDialog open={!!cmDialog} onOpenChange={o => !o && setCmDialog(null)}
        title={cmDialog?.action === 'tag' ? 'Assign Cleanliness Manager' : 'Remove Cleanliness Manager'}
        description={cmDialog?.action === 'tag'
          ? `Assign ${cmDialog?.user.fullName} as a Cleanliness Manager? They will get access to the daily room inspection dashboard.`
          : `Remove Cleanliness Manager role from ${cmDialog?.user.fullName}? They will lose access to the inspection dashboard.`}
        confirmLabel="Confirm" onConfirm={handleCmAction} />

      <ConfirmDialog open={!!bDialog} onOpenChange={o => !o && setBDialog(null)}
        title={bDialog?.action ? 'Mark as B' : 'Remove B Status'}
        description={bDialog?.action
          ? `Mark ${bDialog?.user.fullName} as a B? They will be counted in FOLK Residency Strength reports.`
          : `Remove B status from ${bDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleBAction} />

      <ConfirmDialog open={!!otherCenterDialog} onOpenChange={o => !o && setOtherCenterDialog(null)}
        title={otherCenterDialog?.action ? 'Mark as Other Center' : 'Remove Other Center'}
        description={otherCenterDialog?.action
          ? `Mark ${otherCenterDialog?.user.fullName} as belonging to another center?`
          : `Remove Other Center flag from ${otherCenterDialog?.user.fullName}?`}
        confirmLabel="Confirm" onConfirm={handleOtherCenterAction} />

      <ConfirmDialog open={!!bulkConfirm} onOpenChange={o => !o && setBulkConfirm(null)}
        title={
          bulkConfirm?.flag === 'isB'
            ? (bulkConfirm.value ? 'Bulk Mark as B' : 'Bulk Remove B Status')
            : (bulkConfirm?.value ? 'Bulk Mark as Other Center' : 'Bulk Remove Other Center')
        }
        description={
          bulkConfirm?.flag === 'isB'
            ? (bulkConfirm.value
              ? `Mark ${selCount} selected user${selCount !== 1 ? 's' : ''} as B?`
              : `Remove B status from ${selCount} selected user${selCount !== 1 ? 's' : ''}?`)
            : (bulkConfirm?.value
              ? `Mark ${selCount} selected user${selCount !== 1 ? 's' : ''} as Other Center?`
              : `Remove Other Center from ${selCount} selected user${selCount !== 1 ? 's' : ''}?`)
        }
        confirmLabel={bulkLoading ? 'Updating...' : 'Confirm'}
        onConfirm={handleBulkAction} />

      <ConfirmDialog open={!!statusDialog} onOpenChange={o => !o && setStatusDialog(null)}
        title={statusDialog?.newStatus === 'Inactive' ? 'Deactivate Account' : 'Re-activate Account'}
        description={statusDialog?.newStatus === 'Inactive'
          ? `Deactivate ${statusDialog?.user.fullName}'s account? They will not be able to log in, submit forms, or appear in any reports. You can re-activate them at any time.`
          : `Re-activate ${statusDialog?.user.fullName}'s account? They will regain full access to the app.`}
        confirmLabel={statusDialog?.newStatus === 'Inactive' ? 'Deactivate' : 'Re-activate'}
        onConfirm={handleStatusAction} />

      {/* Residency dialog */}
      {residencyDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg">
              {residencyDialog.makeResident ? '🏠 Make FOLK Resident' : '🌐 Change to Non-Resident'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {residencyDialog.makeResident
                ? `Set ${residencyDialog.user.fullName} as a FOLK Resident? Their sadhana form and reports will switch to the resident template.`
                : `Change ${residencyDialog.user.fullName} to Non-Resident? Their sadhana form and reports will switch to the NR template.`}
            </p>
            {residencyDialog.makeResident && residencies.length > 1 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Assign to FOLK Residency</label>
                <Select value={residencyDialog.residencyId || ''}
                  onValueChange={v => setResidencyDialog({ ...residencyDialog, residencyId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select residency..." /></SelectTrigger>
                  <SelectContent>
                    {residencies.map(r => <SelectItem key={r.id} value={r.id}>{r.residencyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setResidencyDialog(null)}>Cancel</Button>
              <Button onClick={handleResidencyAction}
                disabled={actionLoading === 'residency' || (residencyDialog.makeResident && residencies.length > 1 && !residencyDialog.residencyId)}>
                {actionLoading === 'residency' ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TagMango retry dialog handled via inline toast */}

      {/* Scholar dialog */}
      {scholarDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg">
              {scholarDialog.action === 'assign' ? '🎓 Assign Scholar Status' : 'Remove Scholar Status'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {scholarDialog.action === 'assign'
                ? `Set ${scholarDialog.user.fullName} as a Scholar (temporary FOLK resident). They will appear in the residency report with resident scoring.`
                : `Remove Scholar status from ${scholarDialog.user.fullName}. They will return to non-resident scoring.`}
            </p>
            {scholarDialog.action === 'assign' && residencies.length > 1 && (
              <div>
                <label className="text-sm font-medium mb-2 block">Assign to FOLK Residency</label>
                <Select value={scholarResidencyId} onValueChange={setScholarResidencyId}>
                  <SelectTrigger><SelectValue placeholder="Select residency..." /></SelectTrigger>
                  <SelectContent>
                    {residencies.map(r => <SelectItem key={r.id} value={r.id}>{r.residencyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setScholarDialog(null)}>Cancel</Button>
              <Button
                className={scholarDialog.action === 'assign' ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : ''}
                variant={scholarDialog.action === 'remove' ? 'destructive' : 'default'}
                onClick={handleScholarAction}
                disabled={scholarDialog.action === 'assign' && residencies.length > 1 && !scholarResidencyId}>
                {scholarDialog.action === 'assign' ? 'Assign Scholar' : 'Remove Scholar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Helper components ─────────────────────────────────────────────────── */

function TagMangoBadge({ user }: { user: GuideUser }) {
  const [retrying, setRetrying] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const status = (user as any).tagMangoEnrollmentStatus as string | undefined;
  if (!status || status === 'Not Enrolled') return <span className="text-xs text-muted-foreground">—</span>;

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await retryTagMangoEnrollment({ userId: user.userId });
      toast.success('Retry initiated');
    } catch { toast.error('Retry failed'); }
    finally { setRetrying(false); }
  };

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      const res = await revoketagmangoaccess({ userId: user.userId });
      if (res.success) toast.success('TagMango access revoked');
      else toast.error(res.message);
    } catch { toast.error('Revoke failed'); }
    finally { setRevoking(false); setConfirmRevoke(false); }
  };

  const colorMap: Record<string, string> = {
    Enrolled: 'bg-green-100 text-green-800 border-green-300',
    Failed: 'bg-red-100 text-red-800 border-red-300',
    Processing: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    Pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    Revoked: 'bg-muted text-muted-foreground',
  };
  const cls = colorMap[status] || 'bg-muted text-muted-foreground';

  return (
    <div className="flex items-center gap-1">
      <Badge className={`text-xs ${cls}`}>{status}</Badge>
      {status === 'Failed' && (
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleRetry} disabled={retrying} title="Retry enrollment">
          <RotateCw className={`w-3 h-3 ${retrying ? 'animate-spin' : ''}`} />
        </Button>
      )}
      {status === 'Enrolled' && (
        <>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={e => { e.stopPropagation(); setConfirmRevoke(true); }} title="Revoke access">
            <ShieldOff className="w-3 h-3" />
          </Button>
          <ConfirmDialog
            open={confirmRevoke}
            onOpenChange={o => !o && setConfirmRevoke(false)}
            title="Revoke TagMango Access"
            description={`Revoke ${user.fullName}'s TagMango course access? This will call the TagMango Revoke User API and update their status to "Revoked".`}
            confirmLabel={revoking ? 'Revoking…' : 'Revoke'}
            onConfirm={handleRevoke}
          />
        </>
      )}
    </div>
  );
}

function TagMangoEnrollmentStats({ users }: { users: GuideUser[] }) {
  const stats = useMemo(() => {
    let enrolled = 0, failed = 0, pending = 0;
    for (const u of users) {
      const s = (u as any).tagMangoEnrollmentStatus as string | undefined;
      if (s === 'Enrolled') enrolled++;
      else if (s === 'Failed') failed++;
      else if (s === 'Pending' || s === 'Processing') pending++;
    }
    return { enrolled, failed, pending };
  }, [users]);

  if (stats.enrolled === 0 && stats.failed === 0 && stats.pending === 0) return null;

  return (
    <div className="flex gap-3 mb-3 flex-wrap text-xs">
      <span className="text-muted-foreground">TagMango:</span>
      {stats.enrolled > 0 && <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">{stats.enrolled} enrolled</Badge>}
      {stats.failed > 0 && <Badge className="bg-red-100 text-red-800 border-red-300 text-xs">{stats.failed} failed</Badge>}
      {stats.pending > 0 && <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs">{stats.pending} pending</Badge>}
    </div>
  );
}
