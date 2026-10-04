import { useEffect, useState } from 'react';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { acknowledgeBvRoleNotice, acknowledgeBvApprovalNotice, acknowledgeBvRejectionNotice, acknowledgeAshrayNotice, getUserBvStatus } from '@/lib/endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, XCircle, CheckCircle } from 'lucide-react';

export default function RoleAcknowledgementHandler() {
  const { profile, refreshProfile } = useUserProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{ groupName?: string; bvslName?: string; rgsfName?: string } | null>(null);

  // Determine what type of popup to show
  let popupType: 'ashray_notice_approved' | 'ashray_notice_rejected' | 'bv_approval_notice' | 'bv_rejection_notice' | 'bv_group_assignment_notice' | 'bv_group_removal_notice' | 'bv_role_notice' | null = null;

  // This handler is mounted at the application root, so authenticated users
  // see pending account/approval notices as soon as they open any page. Do not
  // gate them to `/profile`: role and approval changes should be acknowledged
  // on the user's next visit to the website, regardless of which dashboard or
  // deep link they open.
  if (profile) {
    if ((profile as any).pendingBvApprovalNotice) {
      popupType = 'bv_approval_notice';
    } else if ((profile as any).pendingBvRejectionNotice) {
      popupType = 'bv_rejection_notice';
    } else if ((profile as any).pendingBvGroupAssignmentNotice && !(profile as any).roleNoticeAcknowledged) {
      popupType = 'bv_group_assignment_notice';
    } else if ((profile as any).pendingBvGroupRemovalNotice && !(profile as any).roleNoticeAcknowledged) {
      popupType = 'bv_group_removal_notice';
    } else if ((profile as any).pendingRoleNotice && !(profile as any).roleNoticeAcknowledged) {
      popupType = 'bv_role_notice';
    } else if (profile.pendingAshrayNoticeStatus === 'approved' && !profile.ashrayNoticeAcknowledged) {
      popupType = 'ashray_notice_approved';
    } else if (profile.pendingAshrayNoticeStatus === 'rejected' && !profile.ashrayNoticeAcknowledged) {
      popupType = 'ashray_notice_rejected';
    }
  }

  // Fetch Reading Group details when the notice opens. Bypass the client
  // cache: this session's last status read still says the member is unassigned.
  useEffect(() => {
    if (popupType !== 'bv_approval_notice' && popupType !== 'bv_group_assignment_notice') return;
    let cancelled = false;
    getUserBvStatus({ _nocache: true } as { userId?: string; localDate?: string })
      .then(res => {
        if (cancelled || !res?.myGroup) return;
        setGroupInfo({
          groupName: res.myGroup.groupName,
          bvslName: res.myGroup.bvslName,
          rgsfName: res.myGroup.rgsfName,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [popupType]);

  // Sync open state with popup detection
  useEffect(() => {
    if (popupType) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [popupType]);

  if (!popupType || !profile) return null;

  const handleAcknowledge = async () => {
    setBusy(true);
    try {
      if (popupType === 'ashray_notice_approved' || popupType === 'ashray_notice_rejected') {
        await acknowledgeAshrayNotice({});
      } else if (popupType === 'bv_approval_notice') {
        await acknowledgeBvApprovalNotice({});
      } else if (popupType === 'bv_rejection_notice') {
        await acknowledgeBvRejectionNotice({});
      } else if (popupType === 'bv_role_notice' || popupType === 'bv_group_assignment_notice' || popupType === 'bv_group_removal_notice') {
        await acknowledgeBvRoleNotice({});
      }
      await refreshProfile();
      setOpen(false);

    } catch {
      // Keep the database notice pending if acknowledgement fails so it can be
      // shown again instead of being permanently hidden on this device.
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // Render variables
  let title = '';
  let description = '';
  let icon = null;
  const greeting = `Hare Krishna, ${profile.fullName || 'Devotee'}!`;
  const roleNoticeText = String((profile as any).pendingRoleNotice || '');
  // Accept the older "responsibility" notices too, so pending notices saved
  // before this wording change continue to display correctly.
  const roleRemoved = /removed (?:role|responsibility):/i.test(roleNoticeText);
  const roleAssigned = /assigned (?:role|responsibility):/i.test(roleNoticeText);

  switch (popupType) {
    case 'ashray_notice_approved':
      title = 'Ashraya Level Request Approved! 🎉';
      description = `${greeting} Your Ashraya level request for "${profile.pendingAshrayNoticeLevel || 'Ashraya'}" has been approved!`;
      icon = <CheckCircle className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'ashray_notice_rejected':
      title = 'Ashraya Level Request Update';
      description = `${greeting} Your Ashraya level request for "${profile.pendingAshrayNoticeLevel || 'Ashraya'}" was not approved at this time. Please contact your guide for more guidance.`;
      icon = <XCircle className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'bv_approval_notice':
      title = 'Bhakti Vriksha Registration Approved! 🎉';
      description = `${greeting} Your registration to join Bhakti Vriksha has been approved. Welcome to your Reading Group!`;
      icon = <Sparkles className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'bv_rejection_notice':
      title = 'Bhakti Vriksha Registration Update';
      description = `${greeting} Unfortunately, your recent registration for a Bhakti Vriksha reading group was not approved at this time. Please contact your guide for more information.`;
      icon = <XCircle className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'bv_group_assignment_notice':
      title = 'Added to a Bhakti Vriksha Reading Group!';
      description = `${greeting} You have been added to the following Reading Group.`;
      icon = <CheckCircle className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'bv_group_removal_notice':
      title = 'Bhakti Vriksha Group Updated';
      description = `${greeting} You have been removed from your Bhakti Vriksha Reading Group. Your Bhakti Vriksha status is now Unassigned.`;
      icon = <XCircle className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'bv_role_notice': {
      title = roleRemoved && roleAssigned
        ? 'Roles Updated'
        : roleRemoved ? 'Role Removed' : 'New Role Assigned';
      description = roleRemoved && roleAssigned
        ? 'Your account roles have been updated.'
        : roleRemoved
        ? 'The following role has been removed from your account.'
        : 'The following role has been added to your account.';
      icon = roleRemoved
        ? <XCircle className="w-12 h-12 text-destructive mx-auto" />
        : <Sparkles className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val, details) => {
      if (!val && ['escape-key', 'outside-press'].includes(details.reason)) {
        details.cancel();
        return;
      }
      if (!val && !busy) handleAcknowledge();
    }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md text-center p-6 gap-4"
      >
        <div className="pt-2">
          {icon}
        </div>
        <DialogHeader className="items-center text-center">
          <DialogTitle className="text-xl font-bold text-foreground text-center w-full">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        {popupType === 'bv_role_notice' && (
          <div className={`border rounded-lg p-3 text-center text-sm my-1 ${roleRemoved ? 'bg-destructive/10 border-destructive/20' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
            <p className={`font-semibold ${roleRemoved ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}`}>
              {roleRemoved && roleAssigned
                ? 'Role changes:'
                : roleRemoved ? 'Removed role:' : 'Assigned role:'}
            </p>
            <p className="mt-1 whitespace-pre-line">{roleNoticeText.replace(/(removed|assigned) (?:role|responsibility):\s*/gi, '') || 'Account role updated.'}</p>
          </div>
        )}

        {popupType === 'bv_group_assignment_notice' && (
          <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm text-left my-1 space-y-1">
            <p><strong>Reading Group:</strong> {groupInfo?.groupName || (profile as any).bvGroupName || 'Your assigned Reading Group'}</p>
            <p><strong>RGF:</strong> {groupInfo?.bvslName || (profile as any).bvReportingFacilitatorName || 'Not assigned'}</p>
            <p><strong>RGSF:</strong> {groupInfo?.rgsfName || 'None'}</p>
          </div>
        )}

        {popupType === 'bv_group_removal_notice' && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm text-center my-1">
            <p className="font-semibold text-destructive">Reading Group: Unassigned</p>
            <p className="text-muted-foreground mt-1">The Attendance tab will no longer be available unless you are added to a Reading Group again.</p>
          </div>
        )}

        {popupType === 'bv_approval_notice' && (
          <div className="bg-muted/50 border rounded-lg p-3 text-xs text-left space-y-1.5 my-1">
            <p><strong>• Name of Reading Group:</strong> {groupInfo?.groupName || (profile as any).bvGroupName || 'Assigned Group'}</p>
            <p><strong>• RGF:</strong> {groupInfo?.bvslName || (profile as any).bvslLeaderName || (profile as any).bvslName || 'Unassigned'}</p>
            <p><strong>• RGSF:</strong> {groupInfo?.rgsfName || 'None'}</p>
          </div>
        )}

        <DialogFooter className="sm:justify-center w-full flex justify-center mt-2">
          <Button onClick={handleAcknowledge} disabled={busy} className="w-full sm:w-auto px-8">
            {busy ? 'Saving...' : 'Got it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
