import { useEffect, useState } from 'react';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { acknowledgeRoleChange, acknowledgeBvRoleNotice, acknowledgeBvRejectionNotice } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Crown, MapPin, ShieldAlert, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function RoleAcknowledgementHandler() {
  const { profile, refreshProfile } = useUserProfile();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Determine what type of popup to show
  let popupType: 'bv_role_notice' | 'bv_rejection_notice' | 'folk_lead_assigned' | 'folk_lead_removed' | 'trip_coordinator_assigned' | 'trip_coordinator_removed' | 'sadhana_mentor_assigned' | 'sadhana_mentor_removed' | null = null;

  if (profile) {
    if ((profile as any).pendingBvRejectionNotice) {
      popupType = 'bv_rejection_notice';
    } else if ((profile as any).pendingRoleNotice && !(profile as any).roleNoticeAcknowledged) {
      popupType = 'bv_role_notice';
    } else if (profile.isFolkLead && !profile.acknowledgedFolkLead) {
      popupType = 'folk_lead_assigned';
    } else if (!profile.isFolkLead && profile.acknowledgedFolkLead) {
      popupType = 'folk_lead_removed';
    } else if (profile.isTripCoordinator && !profile.acknowledgedTripCoordinator) {
      popupType = 'trip_coordinator_assigned';
    } else if (!profile.isTripCoordinator && profile.acknowledgedTripCoordinator) {
      popupType = 'trip_coordinator_removed';
    } else if (profile.isSadhanaMentor && !profile.acknowledgedSadhanaMentor) {
      popupType = 'sadhana_mentor_assigned';
    } else if (!profile.isSadhanaMentor && profile.acknowledgedSadhanaMentor) {
      popupType = 'sadhana_mentor_removed';
    }
  }

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
      if (popupType === 'bv_rejection_notice') {
        await acknowledgeBvRejectionNotice({});
      } else if (popupType === 'bv_role_notice') {
        await acknowledgeBvRoleNotice({});
      } else if (popupType === 'folk_lead_assigned') {
        await acknowledgeRoleChange({ roleType: 'folk_lead', acknowledged: true });
      } else if (popupType === 'folk_lead_removed') {
        await acknowledgeRoleChange({ roleType: 'folk_lead', acknowledged: false });
      } else if (popupType === 'trip_coordinator_assigned') {
        await acknowledgeRoleChange({ roleType: 'trip_coordinator', acknowledged: true });
      } else if (popupType === 'trip_coordinator_removed') {
        await acknowledgeRoleChange({ roleType: 'trip_coordinator', acknowledged: false });
      } else if (popupType === 'sadhana_mentor_assigned') {
        await acknowledgeRoleChange({ roleType: 'sadhana_mentor', acknowledged: true });
      } else if (popupType === 'sadhana_mentor_removed') {
        await acknowledgeRoleChange({ roleType: 'sadhana_mentor', acknowledged: false });
      }
      toast.success('Role status acknowledged');
      await refreshProfile();
      setOpen(false);
    } catch {
      toast.error('Failed to save acknowledgement');
    } finally {
      setBusy(false);
    }
  };

  // Render variables
  let title = '';
  let description = '';
  let icon = null;

  switch (popupType) {
    case 'bv_rejection_notice':
      title = 'Bhakti Vriksha Registration Rejected';
      description = 'Hare Krishna, Prabhu! Unfortunately, your recent registration for a Bhakti Vriksha reading group was not approved at this time. Please contact your guide for more information.';
      icon = <XCircle className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'bv_role_notice':
      title = 'Bhakti Vriksha Role Update';
      description = `Hare Krishna, Prabhu! Your Bhakti Vriksha role has been updated to: ${(profile as any).pendingRoleNotice || 'Member'}. You now have updated access permissions on the platform.`;
      icon = <Sparkles className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'folk_lead_assigned':
      title = 'Assigned as FOLK Lead';
      description = 'Hare Krishna, Prabhu! You have been assigned the role of FOLK Lead. You now have access to manage hostel rent payments and approve rent corrections for devotees.';
      icon = <Crown className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'folk_lead_removed':
      title = 'FOLK Lead Role Deactivated';
      description = 'Hare Krishna, Prabhu! Your role as FOLK Lead has been deactivated. You will no longer have access to hostel rent and financial panels.';
      icon = <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'trip_coordinator_assigned':
      title = 'Assigned as Trip Coordinator';
      description = 'Hare Krishna, Prabhu! You have been assigned the role of Trip Coordinator. You now have access to manage, import/export, and coordinate devotee travel and trip entries.';
      icon = <MapPin className="w-12 h-12 text-primary mx-auto animate-pulse" />;
      break;
    case 'trip_coordinator_removed':
      title = 'Trip Coordinator Role Deactivated';
      description = 'Hare Krishna, Prabhu! Your role as Trip Coordinator has been deactivated. You will no longer have access to trip management tools.';
      icon = <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />;
      break;
    case 'sadhana_mentor_assigned':
      title = 'Assigned as Sadhana Mentor';
      description = 'Hare Krishna, Prabhu! You have been assigned the role of Sadhana Mentor. You now have access to the Sadhana Mentor dashboard to monitor sadhana reports and schedule 1:1 sessions for devotees.';
      icon = <Crown className="w-12 h-12 text-primary mx-auto animate-bounce" />;
      break;
    case 'sadhana_mentor_removed':
      title = 'Sadhana Mentor Role Deactivated';
      description = 'Hare Krishna, Prabhu! Your role as Sadhana Mentor has been deactivated. You will no longer have access to mentor dashboards and devotee lists.';
      icon = <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />;
      break;
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { if (!val && !busy) handleAcknowledge(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md text-center p-6 gap-6">
        <div className="pt-4">
          {icon}
        </div>
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl font-bold text-foreground text-center w-full">{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-2">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center w-full flex justify-center mt-2">
          <Button onClick={handleAcknowledge} disabled={busy} className="w-full sm:w-auto px-8">
            {busy ? 'Saving...' : 'I Understand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
