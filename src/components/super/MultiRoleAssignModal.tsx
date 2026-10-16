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
import type { PwGroupRole, PwGroupRoleOption } from '@/lib/pwGroupRoles';

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
  readingGroups?: Array<PwGroupRoleOption & { role: PwGroupRole }>;
  departmentGroups?: Array<PwGroupRoleOption & { supervisorIds?: string[] }>;
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
  readingGroups = [],
  departmentGroups = [],
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
  const groupScoped = readingGroups.length > 1;
  const [groupRoles, setGroupRoles] = useState<Record<string, PwGroupRole>>(() =>
    Object.fromEntries(readingGroups.map(group => [group.id, group.role])),
  );
  const facilitatorInAGroup = groupScoped && Object.values(groupRoles).includes('FACILITATOR');
  const subFacilitatorInAGroup = groupScoped && Object.values(groupRoles).includes('SUB_FACILITATOR');

  const [adminParentId, setAdminParentId] = useState(() => resolveInitialParentId(user?.bvReportingAdminId, filteredAdminsList));
  const [supervisorParentId, setSupervisorParentId] = useState(() => resolveInitialParentId(user?.bvReportingSupervisorId, filteredSupervisorsList));
  const [facilitatorParentId, setFacilitatorParentId] = useState(() => resolveInitialParentId(user?.bvReportingFacilitatorId, filteredFacilitatorsList));
  const personRefs = new Set(
    [user?.id, user?.userId, user?.userDbId, user?.email]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const [supervisedIds, setSupervisedIds] = useState<string[]>(() =>
    departmentGroups
      .filter(group => (group.supervisorIds || []).some(id => personRefs.has(String(id).trim().toLowerCase())))
      .map(group => group.id),
  );

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Determine primary role to assign via assignBvRole API while keeping multi-role flags
      const effectiveFacilitator = groupScoped ? facilitatorInAGroup : isFacilitator;
      const effectiveSubFacilitator = groupScoped ? subFacilitatorInAGroup : isSubFacilitator;
      let primaryRole = 'MEMBER';
      let parentId = '';
      let parentName = '';

      if (isAdmin) {
        primaryRole = 'ADMIN';
      } else if (isSupervisor) {
        primaryRole = 'SUPERVISOR';
        parentId = adminParentId;
        parentName = filteredAdminsList.find(a => a.id === adminParentId)?.name || '';
      } else if (effectiveFacilitator) {
        primaryRole = 'FACILITATOR';
        parentId = supervisorParentId;
        parentName = filteredSupervisorsList.find(s => s.id === supervisorParentId)?.name || '';
      } else if (effectiveSubFacilitator) {
        primaryRole = 'SUB_FACILITATOR';
        parentId = facilitatorParentId;
        parentName = filteredFacilitatorsList.find(f => f.id === facilitatorParentId)?.name || '';
      }

      const changedGroupRoles = readingGroups
        .filter(group => groupRoles[group.id] && groupRoles[group.id] !== group.role)
        .map(group => ({ groupId: group.id, role: groupRoles[group.id] }));

      const submission = {
        userId: user.userId || user.id,
        role: primaryRole as any,
        parentId: parentId || undefined,
        parentName: parentName || undefined,
        ...(changedGroupRoles.length > 0 ? { groupRoles: changedGroupRoles } : {}),
        ...(groupScoped && effectiveFacilitator && supervisorParentId ? {
          rgfReportsToId: supervisorParentId,
          rgfReportsToName: filteredSupervisorsList.find(s => s.id === supervisorParentId)?.name || '',
        } : {}),
        ...(groupScoped && effectiveSubFacilitator && facilitatorParentId ? {
          rgsfReportsToId: facilitatorParentId,
          rgsfReportsToName: filteredFacilitatorsList.find(f => f.id === facilitatorParentId)?.name || '',
        } : {}),
        ...(departmentGroups.length > 0 || isSupervisor ? { supervisedGroupIds: isSupervisor ? supervisedIds : [] } : {}),
        multiRoles: {
          isAdmin,
          isSupervisor,
          isFacilitator: effectiveFacilitator,
          isSubFacilitator: effectiveSubFacilitator,
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
          isFacilitator: effectiveFacilitator,
          isSubFacilitator: effectiveSubFacilitator,
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
            {groupScoped
              ? 'This person is in more than one reading group. Choose the role for each group. A change applies only to that group.'
              : 'Select one or more Bhakti Vriksha roles for this user. Multiple roles can be assigned simultaneously.'}
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
              Watches the reading groups you check. Being an RGF of another group does not add that group.
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
            {isSupervisor && (
              <div className="pl-6 pt-1 space-y-1.5">
                <Label className="text-xs font-medium">Reading groups to supervise</Label>
                {departmentGroups.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No reading groups in this department yet.</p>
                ) : (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border p-2">
                    {departmentGroups.map(group => {
                      const checked = supervisedIds.includes(group.id);
                      const rgfHere = (group.rgfIds || group.facilitatorIds || []).some(id => personRefs.has(String(id).trim().toLowerCase()));
                      return (
                        <div key={group.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`supervise-${group.id}`}
                            checked={checked}
                            onCheckedChange={(value) => {
                              setSupervisedIds(current => value
                                ? [...new Set([...current, group.id])]
                                : current.filter(id => id !== group.id));
                            }}
                          />
                          <Label htmlFor={`supervise-${group.id}`} className="text-xs font-normal cursor-pointer">
                            {group.groupName}
                            {rgfHere ? <span className="text-muted-foreground"> · RGF here</span> : null}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {groupScoped ? (
            <div className="p-3 border rounded-lg bg-card space-y-3">
              <div>
                <p className="font-semibold text-sm flex items-center gap-1.5 text-purple-600">
                  <UserCheck className="w-4 h-4" /> Reading group role
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  The same person can be an RGF in one group and an RGSF in another. Each choice stays on that group.
                </p>
              </div>
              {readingGroups.map(group => (
                <div key={group.id} className="space-y-1">
                  <Label className="text-xs font-medium">{group.groupName}</Label>
                  <Select
                    value={groupRoles[group.id] || group.role}
                    onValueChange={(value) => {
                      if (value !== 'FACILITATOR' && value !== 'SUB_FACILITATOR' && value !== 'MEMBER') return;
                      setGroupRoles(current => ({ ...current, [group.id]: value }));
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue>
                        {groupRoles[group.id] === 'SUB_FACILITATOR' ? 'RGSF' : groupRoles[group.id] === 'MEMBER' ? 'Member' : 'RGF'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FACILITATOR">RGF</SelectItem>
                      <SelectItem value="SUB_FACILITATOR">RGSF</SelectItem>
                      <SelectItem value="MEMBER">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {facilitatorInAGroup && (
                <div className="space-y-1">
                  <Label className="text-xs font-medium">RGF reports to Supervisor:</Label>
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
              {subFacilitatorInAGroup && (
                <div className="space-y-1">
                  <Label className="text-xs font-medium">RGSF reports to RGF:</Label>
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
          ) : (
          <>
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
          </>
          )}
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
