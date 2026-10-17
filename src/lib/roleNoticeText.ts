export type AcknowledgementPopup =
  | 'ashray_notice_approved'
  | 'ashray_notice_rejected'
  | 'bv_approval_notice'
  | 'bv_rejection_notice'
  | 'bv_group_assignment_notice'
  | 'bv_group_removal_notice'
  | 'bv_role_notice';

type AcknowledgementProfile = {
  pendingBvApprovalNotice?: boolean | null;
  pendingBvRejectionNotice?: boolean | null;
  pendingBvGroupAssignmentNotice?: boolean | null;
  pendingBvGroupRemovalNotice?: boolean | null;
  roleNoticeAcknowledged?: boolean | null;
  pendingRoleNotice?: unknown;
  pendingAshrayNoticeStatus?: string | null;
  ashrayNoticeAcknowledged?: boolean | null;
};

/** Which one-time notice is waiting, in the order the acknowledgement dialog shows them. */
export function acknowledgementPopup(profile: AcknowledgementProfile | null | undefined): AcknowledgementPopup | null {
  if (!profile) return null;
  if (profile.pendingBvApprovalNotice) return 'bv_approval_notice';
  if (profile.pendingBvRejectionNotice) return 'bv_rejection_notice';
  if (profile.pendingBvGroupAssignmentNotice && !profile.roleNoticeAcknowledged) return 'bv_group_assignment_notice';
  if (profile.pendingBvGroupRemovalNotice && !profile.roleNoticeAcknowledged) return 'bv_group_removal_notice';
  if (profile.pendingRoleNotice && !profile.roleNoticeAcknowledged) return 'bv_role_notice';
  if (profile.pendingAshrayNoticeStatus === 'approved' && !profile.ashrayNoticeAcknowledged) return 'ashray_notice_approved';
  if (profile.pendingAshrayNoticeStatus === 'rejected' && !profile.ashrayNoticeAcknowledged) return 'ashray_notice_rejected';
  return null;
}

export type RoleNoticeParts = {
  assigned: string[];
  removed: string[];
  reportsTo: string | null;
};

/** Split "Assigned role: RGSF | Removed role: RGF" without dropping which change it was. */
export function parseRoleNotice(notice: string): RoleNoticeParts {
  const assigned: string[] = [];
  const removed: string[] = [];
  const pattern = /(assigned|removed)\s+(?:role|responsibility):\s*([^|]+)/gi;
  for (const match of notice.matchAll(pattern)) {
    const names = match[2].split(',').map(name => name.trim()).filter(Boolean);
    if (match[1].toLowerCase() === 'removed') removed.push(...names);
    else assigned.push(...names);
  }
  const reportsTo = notice.match(/now reports to:\s*([^|]+)/i)?.[1]?.trim() || null;
  return { assigned, removed, reportsTo };
}

/** A parent-only save names the new parent. The same role and parent produce no notice. */
export function noticeForRoleUpdate(input: {
  added: string[];
  removed: string[];
  previousParent?: string | null;
  nextParent?: string | null;
}): string | null {
  const parts = [
    input.added.length > 0 ? `Assigned role: ${input.added.join(', ')}` : '',
    input.removed.length > 0 ? `Removed role: ${input.removed.join(', ')}` : '',
  ].filter(Boolean);
  const nextParent = String(input.nextParent || '').trim();
  const previousParent = String(input.previousParent || '').trim();
  if (parts.length === 0 && nextParent && nextParent !== previousParent) {
    return `Now reports to: ${nextParent}`;
  }
  return parts.join(' | ') || null;
}
