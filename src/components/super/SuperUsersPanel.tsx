import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import FilterPanel from '@/components/mobile/FilterPanel';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  getActiveSadhanaMentors, assignSadhanaMentor, getBvslGroups, getAllBvGroupsAdmin, transferBvGroupMember,
} from '@/lib/endpoints-sdk';
import type { GetGuideUsersOutputType, GetGuidesOutputType } from '@/lib/endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { ASHRAY_LEVELS } from '@/types/enums';
import { fmt } from '@/lib/fmt';
import { scoreColor } from '@/lib/scoring';
import { EmptyState, ConfirmDialog } from '@/shared';

import MultiRoleAssignModal from './MultiRoleAssignModal';
import BulkUserManagement from '@/components/guide/BulkUserManagement';

type User = GetGuideUsersOutputType['users'][0] & { id?: string; _guideId: string; _guideName: string };
type GuideEntry = GetGuidesOutputType['guides'][0];
type BvGroupOption = { id: string; groupId: string; groupName: string; segment?: string | null; isActive?: boolean; facilitatorIds?: string[] };
type SortKey = 'fullName' | 'guideName' | 'ashrayLevel' | 'latestScore' | 'latestEntryDate' | 'isResident';
type SortDir = 'asc' | 'desc';
type ResidentLikeUser = Partial<User> & {
  isResident?: boolean | null;
  residencyApproved?: boolean | null;
  residencyGuideVerified?: boolean | null;
  residencyId?: string | null;
  residency?: string | string[] | null;
};

/**
 * Guide assignments have existed in a few shapes over time (canonical userId,
 * Firebase/document id, email, and occasionally a display name). Keep the
 * filter tolerant of those legacy values while using the stable guideId for
 * new selections.
 */
function identityRefs(...values: unknown[]): Set<string> {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      visit(record.id);
      visit(record.userId);
      visit(record.guideId);
      visit(record.email);
      visit(record.name);
      visit(record.fullName);
      return;
    }
    const normalized = String(value).trim().toLowerCase();
    if (normalized) refs.add(normalized);
  };
  values.forEach(visit);
  return refs;
}

function hasSharedIdentity(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40 inline" />;
  return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1 inline" /> : <ArrowDown className="w-3 h-3 ml-1 inline" />;
}

function isFolkResidentUser(user: ResidentLikeUser): boolean {
  const residencyId = user?.residencyId || (Array.isArray(user?.residency) ? user.residency[0] : user?.residency);
  return !!(
    user?.isResident ||
    ((user?.residencyApproved || user?.residencyGuideVerified) && residencyId)
  );
}

// BV roles are independent flags, so a member may legitimately have several
// of them at once. Keep all selected roles available for the table renderer.
const getBvRoleLabels = (user: any): Array<{ key: string; label: string; className: string }> => {
  const role = String(user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  const roles: Array<{ key: string; label: string; className: string }> = [];
  if (user?.isBvAdmin === true || user?.isBvSuperAdmin === true || role === 'BV_ADMIN') {
    roles.push({ key: 'admin', label: 'Admin', className: 'bg-red-100 text-red-700' });
  }
  if (user?.isBvSupervisor === true || user?.isBvMentor === true || role === 'SUPERVISOR' || role === 'BV_SUPERVISOR') {
    roles.push({ key: 'supervisor', label: 'Supervisor', className: 'bg-amber-100 text-amber-700' });
  }
  if (user?.isBvFacilitator === true || user?.isBvsl === true || role === 'FACILITATOR' || role === 'RGF' || role === 'BVSL') {
    roles.push({ key: 'facilitator', label: 'RGF', className: 'bg-purple-100 text-purple-700' });
  }
  if (user?.isBvSubFacilitator === true || role === 'SUB_FACILITATOR' || role === 'RGSF') {
    roles.push({ key: 'sub-facilitator', label: 'RGSF', className: 'bg-blue-100 text-blue-700' });
  }
  return roles;
};

interface SuperUsersPanelProps {
  isPwAdmin?: boolean;
  segment?: 'PW' | 'FOLK';
  isSuperAdminOverride?: boolean;
}

export default function SuperUsersPanel({ isPwAdmin = false, segment, isSuperAdminOverride }: SuperUsersPanelProps) {
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const { profile } = useUserProfile();
  const userEmail = (profile?.userId || '').toLowerCase();

  const effectiveSegment = segment || (isPwAdmin ? 'PW' : 'FOLK');
  const isPwMode = effectiveSegment === 'PW';
  const normalizedProfileRole = String(profile?.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  const canManageBulkUsers = !isPwMode && ['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN'].includes(normalizedProfileRole);

  const isSuperAdmin = isSuperAdminOverride !== undefined ? isSuperAdminOverride : !!(
    profile?.isBvSuperAdmin ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'SUPER_GUIDE'
  );
  const isDepartmentAdmin = !!(
    isSuperAdmin ||
    profile?.isBvAdmin ||
    normalizedProfileRole === 'ADMIN' ||
    normalizedProfileRole === 'PW_ADMIN'
  );

  const [users, setUsers] = useState<User[]>([]);
  const [guides, setGuides] = useState<GuideEntry[]>([]);
  const [bvGroups, setBvGroups] = useState<BvGroupOption[]>([]);

  const myGuideId = useMemo(() => {
    const myEmail = ((profile as any)?.email || profile?.userId || userEmail || '').toLowerCase();
    const matched = guides.find(g => (g.email || '').toLowerCase() === myEmail || (g.guideId || '').toLowerCase() === myEmail);
    return matched ? matched.guideId : (profile?.userId || '');
  }, [guides, profile, userEmail]);

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Department admins own the complete department member directory. Starting
  // them on a guide-specific filter silently hid approved users who had not
  // yet been assigned to a Reading Group/guide.
  const [guideFilter, setGuideFilter] = useState('all');

  useEffect(() => {
    if (profile && !isDepartmentAdmin && myGuideId) {
      setGuideFilter(myGuideId);
    }
  }, [profile, isDepartmentAdmin, myGuideId]);

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
  const [multiRoleUser, setMultiRoleUser] = useState<User | null>(null);
  const [groupTransferDialog, setGroupTransferDialog] = useState<{ user: User; group: BvGroupOption } | null>(null);
  // Hierarchy parent-picker dialog — shown when assigning Supervisor/RGF/RGSF
  const [hierarchyDialog, setHierarchyDialog] = useState<{
    user: User;
    newRole: string;
    roleLabel: string;
    parentLabel: string;          // "Admin" | "Supervisor" | "RGF"
    parentOptions: { id: string; name: string }[];
    parentId: string;
    parentName: string;
  } | null>(null);

  const ROLE_LABELS: Record<string, string> = {
    MEMBER: 'Regular Member',
    SUB_FACILITATOR: 'RGSF',
    FACILITATOR: 'RGF',
    SUPERVISOR: 'BV Supervisor',
    ADMIN: 'BV Admin',
  };
  const [bvMentorGuideId, setBvMentorGuideId] = useState('');
  const [assigningGuide, setAssigningGuide] = useState<string | null>(null);
  const [sadhanaMentors, setSadhanaMentors] = useState<any[]>([]);

  const loadData = useReactiveLoader(async (read, silent = false) => {
    if (!silent) !read.background && setLoading(true);
    try {
      const [{ guides: guideList }, groupsResult, mentorsList, allUsersRes] = await Promise.all([
        read(() => getGuides({ segment: isPwAdmin ? 'PW' : 'FOLK' })),
        (isSuperAdmin
          ? read(() => getBvslGroups({ bvslId: 'ALL' }))
          : read(() => getAllBvGroupsAdmin({ guideId: profile?.userId || userEmail }))
        ).catch(() => ({ groups: [] })),
        isPwAdmin ? read(() => getActiveSadhanaMentors({ segment: 'PW' })).catch(() => []) : Promise.resolve([]),
        read(() => getGuideUsers({ guideId: 'ALL', statusFilter: 'all' })),
      ]);
      setGuides(guideList);
      setBvGroups((groupsResult.groups || []).map((group: any) => ({
        id: group.id || group.groupDbId || group.groupId,
        groupId: group.groupId || group.id || group.groupDbId,
        groupName: group.groupName || 'Unnamed Reading Group',
        segment: group.segment || effectiveSegment,
        isActive: group.isActive,
        facilitatorIds: group.facilitatorIds || (group.bvslLeaderId ? [group.bvslLeaderId] : []),
      })));

      setSadhanaMentors(mentorsList || []);

      // Fetch all registered members (active, pending, unassigned, newly registered)
      const rawUsers: any[] = allUsersRes.users || [];

      // Create comprehensive mentor lookup map (guides + raw users)
      const guideNameMap = new Map<string, string>();
      guideList.forEach((g: any) => {
        const name = g.name || g.fullName || g.guideName || '';
        if (g.guideId) guideNameMap.set(g.guideId, name);
        if (g.id) guideNameMap.set(g.id, name);
        if (g.userId) guideNameMap.set(g.userId, name);
      });
      rawUsers.forEach((u: any) => {
        const name = u.fullName || u.name || '';
        if (u.userId) guideNameMap.set(u.userId, name);
        if (u.id) guideNameMap.set(u.id, name);
      });

      const all: User[] = rawUsers.map((u: any) => {
        const gId = u.selectedGuideId || u.guideId || u.guide || u.mentorId || '';
        let gName = u.selectedGuideName || u.guideName || u.mentorName || u.selectedMentorName || '';

        // Resolve mentor name if missing or raw ID
        if (!gName || gName === gId || gName.includes('-') || /\d{4}/.test(gName)) {
          gName = guideNameMap.get(gId) || 'Unassigned';
        }

        return {
          ...u,
          _guideId: gId,
          _guideName: gName,
        };
      });

      setUsers(all);
    } catch {
      if (read.cancelled) return;
      toast.error('Failed to load users');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [effectiveSegment, isPwAdmin, isSuperAdmin, profile?.userId, userEmail]);

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

  const handleTransferBvGroup = async () => {
    if (!groupTransferDialog) return;
    const { user, group } = groupTransferDialog;
    try {
      const result = await transferBvGroupMember({
        userId: user.id || user.userId,
        groupId: group.id === '__unassigned__' ? null : (group.id || group.groupId),
      });
      setUsers(previous => previous.map(candidate =>
        (user.id && candidate.id === user.id) || candidate.userId === user.userId
          ? {
              ...candidate,
              isBvMember: group.id !== '__unassigned__',
              bvGroupId: result.groupId || null,
              bvGroupName: result.groupName || null,
            }
          : candidate
      ));
      toast.success(group.id === '__unassigned__'
        ? `${user.fullName} is now unassigned from all Reading Groups`
        : `${user.fullName} is now a member of ${result.groupName || group.groupName}`);
      await loadData(true);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to change the Reading Group');
      throw error;
    }
  };

  const handleBvslAction = async () => {
    if (!bvslDialog) return;
    try {
      await tagUserAsBvsl({ userId: bvslDialog.user.userId, action: bvslDialog.action });
      toast.success(bvslDialog.action === 'tag' ? 'RGF role assigned' : 'RGF role removed');
      loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update RGF role');
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

  const handleAssignSadhanaMentor = async (userId: string, mentorId: string) => {
    try {
      await assignSadhanaMentor({ userId, sadhanaMentorId: mentorId });
      setUsers(prev => prev.map(u => {
        const matches = u.userId === userId || (u as any).userDbId === userId || u.id === userId;
        return matches ? { ...u, sadhanaMentor: mentorId } : u;
      }));
      toast.success('Sadhana Mentor assigned');
    } catch {
      toast.error('Failed to assign Sadhana Mentor');
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

  const handleAssignBvRole = async (userId: string, role: string, parentId?: string, parentName?: string) => {
    try {
      const res = await assignBvRole({ userId, role: role as any, parentId, parentName });
      toast.success('Bhakti Vriksha role updated');
      setUsers(prev => prev.map(u => {
        const matches = u.userId === userId || (u as any).userDbId === userId || u.id === userId;
        if (matches) {
          const isSup = role === 'SUPERVISOR';
          const isFac = role === 'FACILITATOR';
          const isSub = role === 'SUB_FACILITATOR';
          const isAdmin = role === 'ADMIN';
          return {
            ...u,
            role: isAdmin ? 'Admin' : isSup ? 'Guide' : isFac ? 'RGF' : 'User',
            isBvAdmin: isAdmin,
            isBvSupervisor: isSup,
            isBvFacilitator: isFac,
            isBvSubFacilitator: isSub,
            isBvsl: isFac,
            isBvMentor: isSup,
            bvReportingAdminId: isSup ? parentId : (res as any)?.bvReportingAdminId || null,
            bvReportingAdminName: isSup ? parentName : (res as any)?.bvReportingAdminName || null,
            bvReportingSupervisorId: isFac ? parentId : (res as any)?.bvReportingSupervisorId || null,
            bvReportingSupervisorName: isFac ? parentName : (res as any)?.bvReportingSupervisorName || null,
            bvReportingFacilitatorId: isSub ? parentId : (res as any)?.bvReportingFacilitatorId || null,
            bvReportingFacilitatorName: isSub ? parentName : (res as any)?.bvReportingFacilitatorName || null,
          };
        }
        return u;
      }));
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update role');
    }
  };

  const isUserInCurrentDepartment = useCallback((u: any, isPw: boolean) => {
    // 1. Strict segment-based database check (prioritized)
    if (u.segment === 'PW' || u.isPrabhupadaWorldUser === true) return isPw;
    if (u.segment === 'FOLK') return !isPw;

    // Records without a segment are not assigned to either dashboard. Segment
    // assignment is performed when their guide/admin is selected.
    return false;
  }, []);

  const formatDevoteeName = (u: any) => {
    if (u.fullName && !u.fullName.includes('@')) return u.fullName;
    if (u.name && !u.name.includes('@')) return u.name;
    if (u.displayName && !u.displayName.includes('@')) return u.displayName;
    if (u.email && u.email.includes('@')) {
      const parts = u.email.split('@')[0].split(/[._-]/);
      return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    }
    return String(u.userId || u.id || 'Devotee');
  };

  // Build parent option lists from already-loaded users (filtered strictly by department: PW vs FOLK)
  const bvAdminsList = useMemo(() => {
    const list = users
      .filter(u => (u as any).isBvAdmin || (u as any).isBvSuperAdmin || u.role === 'Admin' || u.role === 'PW_ADMIN' || u.role === 'SUPER_ADMIN' || u.role === 'SUPER_GUIDE')
      .filter(u => isUserInCurrentDepartment(u, !!isPwAdmin))
      .map(u => ({ id: String(u.userId || u.id || ''), name: formatDevoteeName(u) }))
      .filter(u => u.id.length > 0);

    // Fallback: Add current logged-in profile if admin
    if (profile && (profile.isBvAdmin || profile.isBvSuperAdmin || (profile.role as string) === 'ADMIN' || (profile.role as string) === 'SUPER_ADMIN')) {
      const myId = String(profile.userId || (profile as any).id || '');
      if (myId && !list.some(item => item.id === myId)) {
        list.unshift({ id: myId, name: `${profile.fullName || 'Admin'} (Super Admin)` });
      }
    }

    if (list.length === 0) {
      // Fallback to all guides loaded
      guides.forEach(g => {
        if (g.guideId && g.name) list.push({ id: g.guideId, name: formatDevoteeName(g) });
      });
    }

    return list;
  }, [users, guides, isPwAdmin, isUserInCurrentDepartment, profile]);

  const bvSupervisorsList = useMemo(() => {
    const list = users
      .filter(u => (u as any).isBvSupervisor || (u as any).isBvMentor || u.role === 'Guide')
      .filter(u => isUserInCurrentDepartment(u, !!isPwAdmin))
      .map(u => ({ id: String(u.userId || u.id || ''), name: formatDevoteeName(u) }))
      .filter(u => u.id.length > 0);
    return list.length > 0 ? list : bvAdminsList;
  }, [users, isPwAdmin, isUserInCurrentDepartment, bvAdminsList]);

  const bvFacilitatorsList = useMemo(() => {
    const list = users
      .filter(u => (u as any).isBvFacilitator || (u as any).isBvsl || u.role === 'BVSL' || u.role === 'RGF')
      .filter(u => isUserInCurrentDepartment(u, !!isPwAdmin))
      .map(u => ({ id: String(u.userId || u.id || ''), name: formatDevoteeName(u) }))
      .filter(u => u.id.length > 0);
    return list.length > 0 ? list : bvSupervisorsList;
  }, [users, isPwAdmin, isUserInCurrentDepartment, bvSupervisorsList]);

  // Opens the correct dialog depending on the target role
  const handleRoleDropdownChange = (user: User, newRole: string) => {
    if (!newRole) return;
    const roleLabel = ROLE_LABELS[newRole] || newRole;

    if (newRole === 'SUPERVISOR') {
      const opts = bvAdminsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole, roleLabel,
        parentLabel: 'Admin (will report to)',
        parentOptions: opts,
        parentId: def.id, parentName: def.name,
      });
    } else if (newRole === 'FACILITATOR') {
      const opts = bvSupervisorsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole, roleLabel,
        parentLabel: 'Supervisor (will report to)',
        parentOptions: opts,
        parentId: def.id, parentName: def.name,
      });
    } else if (newRole === 'SUB_FACILITATOR') {
      const opts = bvFacilitatorsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole, roleLabel,
        parentLabel: 'RGF (will report to)',
        parentOptions: opts,
        parentId: def.id, parentName: def.name,
      });
    } else {
      // MEMBER or ADMIN — no parent picker needed, use simple confirm dialog
      setBvRoleDialog({ user, newRole, roleLabel });
    }
  };

  const openParentDialog = (user: User) => {
    const currentBvRole = (user as any).isBvSubFacilitator ? 'SUB_FACILITATOR' :
                          ((user as any).isBvFacilitator || (user as any).isBvsl) ? 'FACILITATOR' :
                          ((user as any).isBvSupervisor || (user as any).isBvMentor) ? 'SUPERVISOR' : 'MEMBER';

    if (currentBvRole === 'SUPERVISOR') {
      const opts = bvAdminsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole: 'SUPERVISOR', roleLabel: 'BV Supervisor',
        parentLabel: 'Admin (will report to)',
        parentOptions: opts,
        parentId: (user as any).bvReportingAdminId || def.id,
        parentName: (user as any).bvReportingAdminName || def.name,
      });
    } else if (currentBvRole === 'FACILITATOR') {
      const opts = bvSupervisorsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole: 'FACILITATOR', roleLabel: 'RGF',
        parentLabel: 'Supervisor (will report to)',
        parentOptions: opts,
        parentId: (user as any).bvReportingSupervisorId || def.id,
        parentName: (user as any).bvReportingSupervisorName || def.name,
      });
    } else if (currentBvRole === 'SUB_FACILITATOR') {
      const opts = bvFacilitatorsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole: 'SUB_FACILITATOR', roleLabel: 'RGSF',
        parentLabel: 'RGF (will report to)',
        parentOptions: opts,
        parentId: (user as any).bvReportingFacilitatorId || def.id,
        parentName: (user as any).bvReportingFacilitatorName || def.name,
      });
    } else {
      const opts = bvFacilitatorsList;
      const def = opts[0] || { id: '', name: '' };
      setHierarchyDialog({
        user, newRole: 'MEMBER', roleLabel: 'Member',
        parentLabel: 'RGF (will assign their group)',
        parentOptions: opts,
        parentId: (user as any).bvReportingFacilitatorId || def.id,
        parentName: (user as any).bvReportingFacilitatorName || def.name,
      });
    }
  };

  const baseUsers = useMemo(() => {
    let r = users;

    // Filter strictly by the current department segment (PW vs FOLK) and only show active (approved) members
    r = r.filter(u => isUserInCurrentDepartment(u, isPwMode) && u.status === 'ACTIVE');

    // Operational roles below Admin (Supervisors, Mentors) filter to members under their direct supervision scope
    if (!isDepartmentAdmin) {
      const myEmail = ((profile as any)?.email || profile?.userId || userEmail || '').toLowerCase();
      const myName = (profile?.fullName || '').toLowerCase();
      const targetGuideId = (myGuideId || '').toLowerCase();

      r = r.filter(u => {
        const uGuideId = (u._guideId || u.selectedGuideId || '').toLowerCase();
        const uGuideName = (u._guideName || '').toLowerCase();
        const uEmail = (u.email || u.userId || '').toLowerCase();

        return (
          (targetGuideId && uGuideId === targetGuideId) ||
          (myEmail && uGuideId === myEmail) ||
          (myName && myName.length > 3 && uGuideName.includes(myName)) ||
          (myEmail && uEmail === myEmail)
        );
      });
    }

    return r;
  }, [users, profile, userEmail, isDepartmentAdmin, isPwMode, isUserInCurrentDepartment, myGuideId]);

  const filtered = useMemo(() => {
    let r = baseUsers;

    // Never apply a stale/hidden guide filter to an Admin's department-wide
    // directory. Group and guide assignment are optional for approved users.
    // Super Admins can inspect the complete directory by mentor. A regular
    // department admin is already scoped to their own hierarchy and does not
    // need a second cross-mentor filter.
    const effectiveGuideFilter = isSuperAdmin ? guideFilter : (isDepartmentAdmin ? 'all' : guideFilter);
    if (effectiveGuideFilter !== 'all') {
      const guideAssignmentValues = (u: User) => [
        u._guideId,
        (u as any).selectedGuideId,
        (u as any).guideId,
        (u as any).guide,
        (u as any).mentorId,
        (u as any).selectedGuideName,
        (u as any).guideName,
        (u as any).mentorName,
        (u as any).selectedMentorName,
        u._guideName,
      ];
      if (effectiveGuideFilter === '__unassigned__') {
        r = r.filter(u => {
          const refs = identityRefs(...guideAssignmentValues(u));
          return refs.size === 0 || [...refs].every(ref => ['unassigned', 'none', 'na', 'n/a', 'null'].includes(ref));
        });
      } else {
        const selectedGuide = guides.find(g => g.guideId === effectiveGuideFilter);
        const selectedRefs = identityRefs(
          effectiveGuideFilter,
          selectedGuide?.guideId,
          (selectedGuide as any)?.id,
          selectedGuide?.email,
          selectedGuide?.name,
        );
        r = r.filter(u => hasSharedIdentity(
          selectedRefs,
          identityRefs(...guideAssignmentValues(u)),
        ));
      }
    }
    if (ashrayFilter !== 'all') r = r.filter(u => u.ashrayLevel === ashrayFilter);
    if (!isPwAdmin) {
      if (residentFilter === 'residents') r = r.filter(isFolkResidentUser);
      else if (residentFilter === 'non_residents') r = r.filter(u => !isFolkResidentUser(u));
    }

    if (search) {
      const q = search.toLowerCase();
      r = r.filter(u =>
        u.fullName.toLowerCase().includes(q) ||
        (u.phone || '').includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u._guideName || '').toLowerCase().includes(q)
      );
    }
    return [...r].sort((a, b) => {
      let av: any, bv: any;
      if (sortKey === 'fullName') { av = a.fullName; bv = b.fullName; }
      else if (sortKey === 'guideName') { av = a._guideName; bv = b._guideName; }
      else if (sortKey === 'ashrayLevel') { av = a.ashrayLevel || ''; bv = b.ashrayLevel || ''; }
      else if (sortKey === 'latestScore') { av = a.latestScore ?? -1; bv = b.latestScore ?? -1; }
      else if (sortKey === 'latestEntryDate') { av = a.latestEntryDate || ''; bv = b.latestEntryDate || ''; }
      else if (sortKey === 'isResident') { av = isFolkResidentUser(a) ? 1 : 0; bv = isFolkResidentUser(b) ? 1 : 0; }
      else { av = ''; bv = ''; }
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [users, guides, guideFilter, ashrayFilter, residentFilter, search, sortKey, sortDir, isPwAdmin, isDepartmentAdmin, isSuperAdmin, myGuideId, profile, userEmail]);

  useEffect(() => { setPage(1); }, [search, guideFilter, ashrayFilter, residentFilter, sortKey, sortDir]);
  const pageSize = mobile ? 10 : 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageUsers = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagination = filtered.length > pageSize && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b text-sm">
              <span className="text-muted-foreground">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} members</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
                <span>{currentPage}/{pageCount}</span>
                <Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
              </div>
            </div>
  );

  if (loading && users.length === 0) return <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

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
            {canManageBulkUsers && (
              <BulkUserManagement
                isSuperGuide={isSuperAdmin}
                onImported={loadData}
              />
            )}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                <label className="text-xs font-medium text-muted-foreground">Search</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Search by name..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              <FilterPanel title="Member filters" summary={ashrayFilter === 'all' ? 'All levels' : ashrayFilter}>
                <div className="flex flex-wrap items-end gap-3">
              {isSuperAdmin && (
                <div className="flex flex-col gap-1 min-w-[160px]">
                  <label className="text-xs font-medium text-muted-foreground">Mentors</label>
                  <Select value={guideFilter} onValueChange={(v) => setGuideFilter(v || 'all')}>
                    <SelectTrigger className="h-9 w-44 shrink-0">
                      <SelectValue>{guideFilter === 'all' ? "All Mentors" : guideFilter === '__unassigned__' ? 'Unassigned' : guides.find(g => g.guideId === guideFilter)?.name || 'Select mentor'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Mentors</SelectItem>
                      <SelectItem value="__unassigned__">Unassigned</SelectItem>
                      {guides.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1 min-w-[140px]">
                <label className="text-xs font-medium text-muted-foreground">Levels</label>
                <Select value={ashrayFilter} onValueChange={(v) => setAshrayFilter(v || 'all')}>
                  <SelectTrigger className="h-9 w-40 shrink-0">
                    <SelectValue>{ashrayFilter === 'all' ? "All Levels" : ashrayFilter}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!isPwAdmin && (
                <div className="flex flex-col gap-1 min-w-[140px]">
                  <label className="text-xs font-medium text-muted-foreground">Residency</label>
                  <Select value={residentFilter} onValueChange={(v) => setResidentFilter(v || 'all')}>
                    <SelectTrigger className="h-9 w-40 shrink-0">
                      <SelectValue>
                        {residentFilter === 'all' ? 'All Users' : residentFilter === 'residents' ? 'Residents Only' : 'Non-Residents'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      <SelectItem value="residents">Residents Only</SelectItem>
                      <SelectItem value="non_residents">Non-Residents</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
                </div>
              </FilterPanel>
            </div>
            {(search !== '' || guideFilter !== 'all' || ashrayFilter !== 'all' || residentFilter !== 'all') && (
              <p className="text-xs text-muted-foreground">
                {filtered.length} of {baseUsers.length} members shown
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pagination}
          <div className="member-table-container overflow-x-auto overflow-y-auto max-h-[72dvh]">
            <table className="mobile-member-table w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b">
                  <Th col="fullName" label="Name" />
                  <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Bhakti Vriksha Role</th>
                  <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Parent</th>
                  <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Bhakti Vriksha Group</th>
                  {isPwAdmin ? (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Sadhana Mentor</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Assign Sadhana Mentor Role</th>
                    </>
                  ) : (
                    <>
                      <Th col="guideName" label="FOLK Guide" />
                    </>
                  )}
                  <Th col="ashrayLevel" label="Ashraya Level" />
                  <Th col="latestScore" label="Weekly Score" />
                  <Th col="latestEntryDate" label="Latest Entry" />
                  {!isPwAdmin && (
                    <>
                      <Th col="isResident" label="Resident" />
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Sadhana Mentor</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">FOLK Lead</th>
                      <th className="text-left px-3 py-2 font-medium text-xs bg-muted">Trip Coord.</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isPwAdmin ? 9 : 12}>
                      <EmptyState icon={Users} title="No users found" description="Try adjusting your filters." />
                    </td></tr>
                ) : pageUsers.map(u => {
                  const isResident = isFolkResidentUser(u);
                  const myId = ((profile as any)?.id || profile?.userId || '').toLowerCase();
                  const myEmail = ((profile as any)?.email || profile?.userId || userEmail || '').toLowerCase();
                  const myName = (profile?.fullName || '').toLowerCase();

                  const uId = (u.id || u.userId || '').toLowerCase();
                  const uEmail = (u.email || u.userId || '').toLowerCase();
                  const uName = (u.fullName || '').toLowerCase();

                  const isSelf = !!(
                    (myId && uId && myId === uId) ||
                    (myEmail && uEmail && (myEmail.includes('@') || uEmail.includes('@')) && myEmail === uEmail) ||
                    (myName && uName && myName.length > 3 && myName === uName) ||
                    (myEmail && uId && myEmail === uId) ||
                    (myId && uEmail && myId === uEmail)
                  );
                  const isBvUser = !!(
                    (u as any).isBvMember ||
                    (u as any).bvRegistrationStatus === 'Approved' ||
                    (u as any).isBvAdmin ||
                    (u as any).isBvSupervisor ||
                    (u as any).isBvMentor ||
                    (u as any).isBvFacilitator ||
                    (u as any).isBvsl ||
                    (u as any).isBvSubFacilitator ||
                    (u as any).bvGroupId ||
                    (u as any).bvReportingFacilitatorId ||
                    (u as any).bvReportingSupervisorId ||
                    (u as any).bvReportingAdminId
                  );
                  const bvRoleLabels = getBvRoleLabels(u);
                  const currentBvRole = ((u as any).isBvAdmin || (u as any).isBvSuperAdmin) ? 'ADMIN' :
                    (u as any).isBvSupervisor ? 'SUPERVISOR' :
                    ((u as any).isBvFacilitator || (u as any).isBvsl) ? 'FACILITATOR' :
                    (u as any).isBvSubFacilitator ? 'SUB_FACILITATOR' :
                    isBvUser ? 'MEMBER' : 'NA';

                  const canEditRole = isSuperAdmin || isPwAdmin || !!(profile as any)?.isBvAdmin || (profile?.role as string) === 'ADMIN';
                  const memberSegment = String((u as any).segment || effectiveSegment || '').toUpperCase();
                  const availableBvGroups = bvGroups.filter(group => {
                    const groupSegment = String(group.segment || '').toUpperCase();
                    return group.isActive !== false && (!groupSegment || !memberSegment || groupSegment === memberSegment);
                  });
                  const currentBvGroup = availableBvGroups.find(group =>
                    group.id === (u as any).bvGroupId || group.groupId === (u as any).bvGroupId
                  );
                  const userRole = String((u as any).role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
                  const isRgf = !!((u as any).isBvFacilitator || (u as any).isBvsl || ['RGF', 'BVSL', 'FACILITATOR'].includes(userRole));
                  const isSupervisor = !!((u as any).isBvSupervisor || (u as any).isBvMentor || ['SUPERVISOR', 'BV_SUPERVISOR', 'MENTOR'].includes(userRole));
                  const isRgsf = !!((u as any).isBvSubFacilitator || ['RGSF', 'SUB_FACILITATOR'].includes(userRole));
                  const roleGroup = isRgf
                    ? availableBvGroups.find(group => (group.facilitatorIds || []).some(ref =>
                        [u.id, u.userId, (u as any).email].filter(Boolean).map(value => String(value).toLowerCase()).includes(String(ref).toLowerCase())
                      ))
                    : currentBvGroup;
                  const isRoleGroupLocked = isRgf || isSupervisor || isRgsf;
                  const groupSelectValue = currentBvGroup?.id || (u as any).bvGroupId || '__unassigned__';

                  return (
                    <tr key={u.userId} data-expanded={expandedRows.has(u.userId)} className="border-b hover:bg-accent/40 cursor-pointer"
                      onClick={() => navigate(`/guide/users/${u.userId}`)}>
                      {/* 1. Name */}
                      <td data-label="Name" data-summary="true" className="px-3 py-2 font-medium sticky left-0 bg-background z-1 border-r border-border/40 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                          <button type="button" className="min-h-11 min-w-0 text-left font-semibold md:min-h-0" onClick={e => { e.stopPropagation(); navigate(`/guide/users/${u.userId}`); }}>{u.fullName}</button>
                          <Button variant="ghost" size="sm" className="md:hidden shrink-0 text-primary" aria-expanded={expandedRows.has(u.userId)} aria-label={`Details for ${u.fullName}`}
                            onClick={e => { e.stopPropagation(); setExpandedRows(current => { const next = new Set(current); if (next.has(u.userId)) next.delete(u.userId); else next.add(u.userId); return next; }); }}>
                            {expandedRows.has(u.userId) ? 'Less' : 'Details'}
                          </Button>
                        </div>
                      </td>
                      {/* 2. Bhakti Vriksha Role */}
                      <td data-label="Roles" data-summary="true" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {currentBvRole === 'NA' ? (
                          <span className="text-muted-foreground/60 text-xs font-normal px-2.5 py-1 bg-muted/30 border border-border/50 rounded inline-block">NA</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-auto min-h-[30px] py-1 px-2 text-xs flex items-center justify-between gap-1.5 border-dashed border-primary/60 hover:border-primary hover:bg-primary/10 min-w-[150px] cursor-pointer inline-flex w-full"
                            disabled={!canEditRole}
                            onClick={() => setMultiRoleUser(u)}
                            title="Click to assign or edit Bhakti Vriksha roles and parent reporting hierarchy"
                          >
                            <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
                              {bvRoleLabels.map(({ key, label, className }) => (
                                <span key={key} className={`text-[10px] px-1.5 py-0.5 ${className} font-semibold rounded shrink-0`}>
                                  {label}
                                </span>
                              ))}
                              {bvRoleLabels.length === 0 && currentBvRole === 'MEMBER' && (
                                <span className="text-muted-foreground text-xs font-normal">Member</span>
                              )}
                            </div>
                            {canEditRole && <span className="text-[10px] text-primary font-semibold ml-1 shrink-0">✏️ Edit</span>}
                          </Button>
                        )}
                      </td>
                      {/* 3. Parent */}
                      {(() => {
                        const isUserAdmin = !!((u as any).isBvAdmin || (u as any).isBvSuperAdmin || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' || u.role === 'PW_ADMIN');
                        const formatName = (val: string) => {
                          if (!val) return '';
                          if (val.includes('@')) {
                            const parts = val.split('@')[0].split(/[._-]/);
                            return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
                          }
                          return val;
                        };
                        const resolveParentUser = (parentId: unknown, parentName: unknown) => {
                          const refs = [parentId, parentName]
                            .map(value => String(value || '').trim().toLowerCase())
                            .filter(Boolean);
                          if (refs.length === 0) return null;
                          return users.find(candidate => [candidate.id, candidate.userId, candidate.email, candidate.fullName]
                            .map(value => String(value || '').trim().toLowerCase())
                            .some(ref => refs.includes(ref))) || null;
                        };
                        const parentRoleLabel = (parentId: unknown, parentName: unknown, fallback: string) => {
                          const parent = resolveParentUser(parentId, parentName) as any;
                          const role = String(parent?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
                          if (parent?.isBvSubFacilitator === true || ['RGSF', 'SUB_FACILITATOR'].includes(role) || role.includes('SUB_FACILITATOR')) return 'RGSF';
                          if (parent?.isBvFacilitator === true || parent?.isBvsl === true || ['RGF', 'BVSL', 'FACILITATOR'].includes(role)) return 'RGF';
                          if (parent?.isBvSupervisor === true || parent?.isBvMentor === true || role.includes('SUPERVISOR')) return 'Supervisor';
                          if (parent?.isBvAdmin === true || parent?.isBvSuperAdmin === true || ['ADMIN', 'SUPER_ADMIN', 'PW_ADMIN'].includes(role)) return 'Admin';
                          return fallback;
                        };
                        const superAdminDisplayName = formatName((u as any).bvReportingAdminName) || 'Unassigned';
                        return (
                          <td data-label="Parent" className="px-3 py-2 text-xs" onClick={e => { e.stopPropagation(); if (canEditRole && !isUserAdmin && currentBvRole !== 'NA') openParentDialog(u); }}>
                            {isUserAdmin ? (
                              <span className="text-muted-foreground font-medium cursor-default">{superAdminDisplayName}</span>
                            ) : currentBvRole === 'NA' ? (
                              <span className="text-muted-foreground/60 font-normal cursor-default">—</span>
                            ) : (
                              <button
                                type="button"
                                className="text-left hover:underline focus:outline-none cursor-pointer flex items-center gap-1 group"
                                title="Click to change reporting parent hierarchy"
                              >
                                <span className="text-muted-foreground font-medium group-hover:text-primary">
                                  {(() => {
                                    if (currentBvRole === 'SUPERVISOR') {
                                      return (u as any).bvReportingAdminName
                                        ? `${formatName((u as any).bvReportingAdminName)} (Admin)`
                                        : 'Unassigned (Admin)';
                                    }
                                    if (currentBvRole === 'FACILITATOR') {
                                      return (u as any).bvReportingSupervisorName
                                        ? `${formatName((u as any).bvReportingSupervisorName)} (Supervisor)`
                                        : 'Unassigned (Supervisor)';
                                    }
                                    if (currentBvRole === 'SUB_FACILITATOR') {
                                      return (u as any).bvReportingFacilitatorName
                                        ? `${formatName((u as any).bvReportingFacilitatorName)} (RGF)`
                                        : 'Unassigned (RGF)';
                                    }
                                    // Regular Member
                                    const facName = (u as any).bvReportingFacilitatorName;
                                    const facId = (u as any).bvReportingFacilitatorId;
                                    const supName = (u as any).bvReportingSupervisorName || (u as any).supervisorName || (u as any).bvSupervisorName;
                                    const adminName = (u as any).bvReportingAdminName;

                                    if (facName) return `${formatName(facName)} (${parentRoleLabel(facId, facName, 'RGF')})`;
                                    if (supName) return `${formatName(supName)} (Supervisor)`;
                                    if (adminName) return `${formatName(adminName)} (Admin)`;

                                    const guideDisplayName = u._guideName && !u._guideName.includes('-')
                                      ? u._guideName
                                      : 'Unassigned';
                                    return `${guideDisplayName} (Admin)`;
                                  })()}
                                </span>
                                {canEditRole && <span className="text-[10px] text-primary/70 group-hover:text-primary">✏️</span>}
                              </button>
                            )}
                          </td>
                        );
                      })()}
                      <td data-label="Bhakti Vriksha Group" data-summary="true" className="px-3 py-2 text-xs" onClick={e => e.stopPropagation()}>
                        {isBvUser ? isRoleGroupLocked ? (
                          <span className="text-muted-foreground font-medium" title="This role is tied to its assigned Reading Group">
                            {roleGroup?.groupName || (u as any).bvGroupName || 'Unassigned'}
                          </span>
                        ) : (
                          <Select
                            value={groupSelectValue}
                            onValueChange={(value) => {
                              if (value === '__unassigned__') {
                                setGroupTransferDialog({ user: u, group: { id: '__unassigned__', groupId: '__unassigned__', groupName: 'Unassigned' } });
                                return;
                              }
                              const selectedGroup = availableBvGroups.find(group => group.id === value || group.groupId === value);
                              if (!selectedGroup || selectedGroup.id === currentBvGroup?.id) return;
                              setGroupTransferDialog({ user: u, group: selectedGroup });
                            }}
                            disabled={!canEditRole}
                          >
                            <SelectTrigger className="h-7 text-xs w-48" aria-label={`Bhakti Vriksha Group for ${u.fullName}`}>
                              <span className="truncate">{currentBvGroup?.groupName || (u as any).bvGroupName || ((u as any).bvGroupId ? 'Group name unavailable' : 'Unassigned')}</span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__unassigned__">Unassigned</SelectItem>
                              {!currentBvGroup && (u as any).bvGroupId && (
                                <SelectItem value={groupSelectValue}>
                                  {(u as any).bvGroupName || 'Current group unavailable'}
                                </SelectItem>
                              )}
                              {availableBvGroups.map(group => (
                                <SelectItem key={group.id} value={group.id}>{group.groupName}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-muted-foreground">NA</span>
                        )}
                      </td>
                      {/* The Guide dropdown belongs only to FOLK. PW BV ownership
                          is derived from the selected RGF/group hierarchy. */}
                      {!isPwAdmin && (
                        <td data-label="FOLK Guide" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          {(() => {
                            const currentGid = u.selectedGuideId || u._guideId || '';
                            const matchedGuide = guides.find(g =>
                              g.guideId === currentGid ||
                              (g as any).id === currentGid ||
                              (g as any).userId === currentGid
                            );
                            const displayName = matchedGuide
                              ? matchedGuide.name
                              : (u._guideName && !u._guideName.includes('-') ? u._guideName : 'Unassigned');

                            return (
                              <Select value={matchedGuide?.guideId || currentGid || ''} onValueChange={gid => gid && handleAssignGuide(u.userId, gid)} disabled={assigningGuide === u.userId || isSelf || (!isSuperAdmin && currentBvRole === 'ADMIN')}>
                                <SelectTrigger className="h-7 text-xs w-44">
                                  <span className="truncate">{displayName}</span>
                                </SelectTrigger>
                                <SelectContent>
                                  {guides.map(g => <SelectItem key={g.guideId} value={g.guideId}>{g.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            );
                          })()}
                        </td>
                      )}
                      {isPwAdmin && (
                        <>
                          <td data-label="Sadhana Mentor" className="px-3 py-2 text-xs" onClick={e => e.stopPropagation()}>
                            {isBvUser ? (
                              <span className="text-muted-foreground/60 font-normal">NA</span>
                            ) : (
                              <Select
                                value={u.sadhanaMentor || '__unassigned__'}
                                onValueChange={mentorId => handleAssignSadhanaMentor(u.userId, mentorId === '__unassigned__' ? '' : mentorId)}
                                disabled={isSelf}
                              >
                                <SelectTrigger className="h-7 text-xs w-44">
                                  <span className="truncate">
                                    {sadhanaMentors.find(m => m.userId === u.sadhanaMentor)?.fullName || 'Unassigned'}
                                  </span>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                                  {sadhanaMentors.map(m => (
                                    <SelectItem key={m.userId} value={m.userId}>{m.fullName}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>

                          <td data-label="Assign Sadhana Mentor Role" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setSadhanaMentorDialog({ user: u, action: (u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'untag' : 'tag' })}
                            >
                              {(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                        </>
                      )}
                      {/* 5. Ashraya Level */}
                      <td data-label="Ashraya Level" className="px-3 py-2 text-xs">{u.ashrayLevel || '—'}</td>
                      {/* 6. Weekly Score */}
                      <td data-label="Weekly Score" data-summary="true" className="px-3 py-2">
                        {u.latestScore != null
                          ? <span className={`font-semibold ${scoreColor(u.latestScore, isResident)}`}>{u.latestScore}%</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      {/* 7. Latest Entry */}
                      <td data-label="Latest Entry" className="px-3 py-2 text-xs text-muted-foreground">{fmt.date(u.latestEntryDate)}</td>
                      {!isPwAdmin && (
                        <>
                          <td data-label="Residency" className="px-3 py-2">
                            {isResident ? (
                              <span className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                                <Home className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  {u.residencyName
                                    ? String(u.residencyName).replace(/^FOLK\s+/i, '')
                                    : 'Resident'}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">Non-Resident</span>
                            )}
                          </td>
                          {/* 1. Sadhana Mentor */}
                          <td data-label="Sadhana Mentor Role" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setSadhanaMentorDialog({ user: u, action: (u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? 'untag' : 'tag' })}>
                              {(u.isSadhanaMentor || u.role === 'SADHANA_MENTOR') ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          {/* 2. FOLK Lead */}
                          <td data-label="FOLK Lead" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u as any).isFolkLead ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setFolkLeadDialog({ user: u, action: (u as any).isFolkLead ? 'untag' : 'tag' })}>
                              {(u as any).isFolkLead ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
                            </button>
                          </td>
                          {/* 3. Trip Coord. */}
                          <td data-label="Trip Coordinator" className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <button
                              className={`inline-flex items-center text-xs px-2 py-1 rounded border transition-colors ${(u as any).isTripCoordinator ? 'border-border text-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}
                              onClick={() => setTripCoordDialog({ user: u, action: (u as any).isTripCoordinator ? 'untag' : 'tag' })}>
                              {(u as any).isTripCoordinator ? <><StarOff className="w-3 h-3 mr-1" />Remove</> : <><Star className="w-3 h-3 mr-1" />Assign</>}
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
          <div className="md:hidden">{pagination}</div>
        </CardContent>
      </Card>

      {/* RGF confirmation — replaces AlertDialog block */}
      <ConfirmDialog
        open={!!bvslDialog}
        onOpenChange={o => !o && setBvslDialog(null)}
        title={bvslDialog?.action === 'tag' ? 'Assign RGF Role' : 'Remove RGF Role'}
        description={bvslDialog?.action === 'tag'
          ? `Assign ${bvslDialog?.user.fullName} as RGF? They will gain access to the RGF dashboard.`
          : `Remove RGF role from ${bvslDialog?.user.fullName}?`}
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
      <ConfirmDialog
        open={!!groupTransferDialog}
        onOpenChange={open => !open && setGroupTransferDialog(null)}
        title="Change Bhakti Vriksha Reading Group?"
        description={groupTransferDialog
          ? groupTransferDialog.group.id === '__unassigned__'
            ? `Remove ${groupTransferDialog.user.fullName} from all Bhakti Vriksha Reading Groups?`
            : `Move ${groupTransferDialog.user.fullName} to ${groupTransferDialog.group.groupName}? They will be removed from their previous Reading Group and added as a member of this one.`
          : ''}
        confirmLabel="Confirm Group Change"
        onConfirm={async () => {
          await handleTransferBvGroup();
          setGroupTransferDialog(null);
        }}
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

      {/* Hierarchy Parent-Picker Dialog — for Supervisor / RGF / RGSF assignment */}
      {hierarchyDialog && (
        <AlertDialog open onOpenChange={o => { if (!o) setHierarchyDialog(null); }}>
          <AlertDialogContent className="max-w-md w-full p-6 bg-card border border-border rounded-2xl shadow-xl space-y-4 overflow-hidden">
            <AlertDialogHeader className="space-y-1 text-left">
              <AlertDialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
                <Users className="w-5 h-5 text-primary shrink-0" />
                Assign Reporting Parent ({hierarchyDialog.roleLabel})
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground space-y-1">
                <span className="block">Please select who <span className="font-semibold text-foreground">{hierarchyDialog.user.fullName}</span> will report to.</span>
                {hierarchyDialog.newRole === 'MEMBER' && (
                  <span className="block text-amber-600 dark:text-amber-400 font-medium">
                    ℹ️ The member will be assigned to this RGF's active Reading Group.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-2 space-y-2">
              <label className="text-xs font-bold text-foreground block">
                {hierarchyDialog.parentLabel}
              </label>
              {hierarchyDialog.parentOptions.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 rounded-xl p-3">
                  ⚠️ No {hierarchyDialog.parentLabel.split(' ')[0]}s found in the system yet. Please assign that role first before assigning this one.
                </p>
              ) : (
                <Select
                  value={hierarchyDialog.parentId}
                  onValueChange={(id: string | null) => {
                    if (!id) return;
                    const selected = hierarchyDialog.parentOptions.find(p => p.id === id);
                    const selectedName = selected?.name || '';
                    setHierarchyDialog(prev => prev ? { ...prev, parentId: id, parentName: selectedName } : null);
                  }}
                >
                  <SelectTrigger className="w-full h-9 text-xs">
                    <SelectValue placeholder={`Select ${hierarchyDialog.parentLabel.split(' ')[0]}…`}>
                      {hierarchyDialog.parentOptions.find(p => p.id === hierarchyDialog.parentId)?.name || hierarchyDialog.parentName || `Select ${hierarchyDialog.parentLabel.split(' ')[0]}…`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {hierarchyDialog.parentOptions.map(opt => (
                      <SelectItem key={opt.id} value={opt.id} className="text-xs">{opt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <AlertDialogFooter className="pt-3 border-t border-border flex flex-row items-center justify-end gap-2.5">
              <AlertDialogCancel onClick={() => setHierarchyDialog(null)} className="h-9 px-4 text-xs font-semibold rounded-xl cursor-pointer">Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!hierarchyDialog.parentId || hierarchyDialog.parentOptions.length === 0}
                onClick={async () => {
                  if (!hierarchyDialog) return;
                  await handleAssignBvRole(
                    hierarchyDialog.user.userId,
                    hierarchyDialog.newRole,
                    hierarchyDialog.parentId,
                    hierarchyDialog.parentName,
                  );
                  setHierarchyDialog(null);
                }}
                className="h-9 px-4 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Confirm & Assign
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {multiRoleUser && (
        <MultiRoleAssignModal
          open={!!multiRoleUser}
          user={multiRoleUser}
          isSuperAdmin={isSuperAdmin}
          adminsList={bvAdminsList}
          supervisorsList={bvSupervisorsList}
          facilitatorsList={bvFacilitatorsList}
          onClose={() => setMultiRoleUser(null)}
          onSaved={() => loadData()}
        />
      )}
    </>
  );
}
