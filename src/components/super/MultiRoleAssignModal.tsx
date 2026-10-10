import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, ShieldAlert, Network, UserCheck, Users } from 'lucide-react';
import { toast } from 'sonner';
import { assignBvRole } from '@/lib/endpoints-sdk';
import { sendOrQueue } from '@/lib/offlineQueue';
import { bvRolePatch, type PendingDirectoryPatch } from '@/lib/pendingDirectoryPatch';

interface OptionItem {
  id: string;
  name: string;
  rawUser?: any;
}

interface Props {
  open: boolean;
  user: any;
  isSuperAdmin: boolean;
  adminsList: OptionItem[];
  supervisorsList: OptionItem[];
  facilitatorsList: OptionItem[];
  onClose: () => void;
  onSaved: (update: { user: any; patch: PendingDirectoryPatch }) => void;
}

function resolveInitialParentId(val: string | undefined, list: OptionItem[]): string {
  if (!list || list.length === 0) return '';
  if (!val) return list[0].id;
  const v = String(val).toLowerCase();
  const match = list.find(item =>
    item.id.toLowerCase() === v ||
    item.name.toLowerCase() === v ||
    (item.rawUser?.id && String(item.rawUser.id).toLowerCase() === v) ||
    (item.rawUser?.userId && String(item.rawUser.userId).toLowerCase() === v) ||
    (item.rawUser?.email && String(item.rawUser.email).toLowerCase() === v) ||
    (item.rawUser?.fullName && String(item.rawUser.fullName).toLowerCase() === v)
  );
  return match ? match.id : list[0].id;
}

export default function MultiRoleAssignModal({
  open,
  user,
  isSuperAdmin,
  adminsList,
  supervisorsList,
  facilitatorsList,
  onClose,
  onSaved,
}: Props) {
  // Filter out the target user from parent lists — a user cannot report to themselves
  const selfId = String(user?.userId || user?.id || '').toLowerCase();
  const selfEmail = String(user?.email || '').toLowerCase();
  const filterSelf = (list: OptionItem[]) => list.filter(item => {
    const itemId = String(item.id || '').toLowerCase();
    const itemUserId = String((item as any).rawUser?.userId || (item as any).userId || '').toLowerCase();
    const itemEmail = String((item as any).rawUser?.email || (item as any).email || '').toLowerCase();
    return itemId !== selfId && itemUserId !== selfId &&
           itemId !== selfEmail && itemEmail !== selfEmail &&
           itemUserId !== selfEmail;
  });

  const filteredAdminsList = filterSelf(adminsList);
  const filteredSupervisorsList = filterSelf(supervisorsList);
  const filteredFacilitatorsList = filterSelf(facilitatorsList);

  const [isAdmin, setIsAdmin] = useState(!!user?.isBvAdmin);
  const [isSupervisor, setIsSupervisor] = useState(!!(user?.isBvSupervisor || user?.isBvMentor));
  const [isFacilitator, setIsFacilitator] = useState(!!(user?.isBvFacilitator || user?.isBvsl));
  const [isSubFacilitator, setIsSubFacilitator] = useState(!!user?.isBvSubFacilitator);

  const [adminParentId, setAdminParentId] = useState(() => resolveInitialParentId(user?.bvReportingAdminId, filteredAdminsList));
  const [supervisorParentId, setSupervisorParentId] = useState(() => resolveInitialParentId(user?.bvReportingSupervisorId, filteredSupervisorsList));
  const [facilitatorParentId, setFacilitatorParentId] = useState(() => resolveInitialParentId(user?.bvReportingFacilitatorId, filteredFacilitatorsList));

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Determine primary role to assign via assignBvRole API while keeping multi-role flags
      let primaryRole = 'MEMBER';
      let parentId = '';
      let parentName = '';

      if (isAdmin) {
        primaryRole = 'ADMIN';
      } else if (isSupervisor) {
        primaryRole = 'SUPERVISOR';
        parentId = adminParentId;
        parentName = filteredAdminsList.find(a => a.id === adminParentId)?.name || '';
      } else if (isFacilitator) {
        primaryRole = 'FACILITATOR';
        parentId = supervisorParentId;
        parentName = filteredSupervisorsList.find(s => s.id === supervisorParentId)?.name || '';
      } else if (isSubFacilitator) {
        primaryRole = 'SUB_FACILITATOR';
        parentId = facilitatorParentId;
        parentName = filteredFacilitatorsList.find(f => f.id === facilitatorParentId)?.name || '';
      }

      const submission = {
        userId: user.userId || user.id,
        role: primaryRole as any,
        parentId: parentId || undefined,
        parentName: parentName || undefined,
        multiRoles: {
          isAdmin,
          isSupervisor,
          isFacilitator,
          isSubFacilitator,
        },
      };
      const outcome = await sendOrQueue({
        type: 'role_update',
        dedupeKey: `role:${submission.userId}`,
        payload: { endpoint: 'assignBvRole', input: submission },
        send: () => assignBvRole(submission),
      });
      if (outcome.status === 'queued') return;

      toast.success(`Updated roles for ${user.fullName}`);
      onSaved({
        user,
        patch: bvRolePatch({
          isAdmin,
          isSupervisor,
          isFacilitator,
          isSubFacilitator,
          primaryRole,
          parentId,
          parentName,
        }),
      });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update roles');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Assign Roles for {user?.fullName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select one or more Bhakti Vriksha roles for this user. Multiple roles can be assigned simultaneously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 1. BV Admin */}
          {isSuperAdmin && (
            <div className="p-3 border rounded-lg bg-card space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="role-admin"
                  checked={isAdmin}
                  onCheckedChange={(c) => setIsAdmin(!!c)}
                />
                <Label htmlFor="role-admin" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5 text-red-600">
                  <ShieldAlert className="w-4 h-4" /> BV Admin
                </Label>
              </div>
              <p className="text-[11px] text-muted-foreground pl-6">
                Full administrative access across the entire Bhakti Vriksha hierarchy.
              </p>
            </div>
          )}

          {/* 2. BV Supervisor */}
          <div className="p-3 border rounded-lg bg-card space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="role-supervisor"
                checked={isSupervisor}
                onCheckedChange={(c) => setIsSupervisor(!!c)}
              />
              <Label htmlFor="role-supervisor" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5 text-amber-600">
                <Network className="w-4 h-4" /> BV Supervisor
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Supervises RGFs and monitors sector reports.
            </p>
            {isSupervisor && (
              <div className="pl-6 pt-1 space-y-1">
                <Label className="text-xs font-medium">Reports to Admin:</Label>
                <Select value={adminParentId} onValueChange={(v) => setAdminParentId(v || 'all')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>
                      {filteredAdminsList.find(a => a.id === adminParentId)?.name || 'System Administrator (Default)'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredAdminsList.length > 0 ? (
                      filteredAdminsList.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)
                    ) : (
                      <SelectItem value="system_admin">System Administrator (Default)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 3. Facilitator (RGF) */}
          <div className="p-3 border rounded-lg bg-card space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="role-facilitator"
                checked={isFacilitator}
                onCheckedChange={(c) => setIsFacilitator(!!c)}
              />
              <Label htmlFor="role-facilitator" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5 text-purple-600">
                <UserCheck className="w-4 h-4" /> RGF
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Hosts reading groups, marks session attendance, and logs 1:1 call reports.
            </p>
            {isFacilitator && (
              <div className="pl-6 pt-1 space-y-1">
                <Label className="text-xs font-medium">Reports to Supervisor:</Label>
                <Select value={supervisorParentId} onValueChange={(v) => setSupervisorParentId(v || 'all')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>
                      {filteredSupervisorsList.find(s => s.id === supervisorParentId)?.name || 'Default Supervisor'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSupervisorsList.length > 0 ? (
                      filteredSupervisorsList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)
                    ) : (
                      <SelectItem value="default_supervisor">Default Supervisor</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 4. Sub-Facilitator (RGSF) */}
          <div className="p-3 border rounded-lg bg-card space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="role-sub"
                checked={isSubFacilitator}
                onCheckedChange={(c) => setIsSubFacilitator(!!c)}
              />
              <Label htmlFor="role-sub" className="font-semibold text-sm cursor-pointer flex items-center gap-1.5 text-blue-600">
                <Users className="w-4 h-4" /> RGSF
              </Label>
            </div>
            <p className="text-[11px] text-muted-foreground pl-6">
              Assists an RGF with specific assigned reading groups.
            </p>
            {isSubFacilitator && (
              <div className="pl-6 pt-1 space-y-1">
                <Label className="text-xs font-medium">Reports to RGF:</Label>
                <Select value={facilitatorParentId} onValueChange={(v) => setFacilitatorParentId(v || 'all')}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue>
                      {filteredFacilitatorsList.find(f => f.id === facilitatorParentId)?.name || 'Default RGF'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredFacilitatorsList.length > 0 ? (
                      filteredFacilitatorsList.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)
                    ) : (
                      <SelectItem value="default_rgf">Default RGF</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Roles'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
