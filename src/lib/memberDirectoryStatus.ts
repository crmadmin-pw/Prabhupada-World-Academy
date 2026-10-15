/**
 * Directory data has existed with both database labels ("Active") and API
 * values ("ACTIVE"). Keep client-side member visibility independent of that
 * presentation detail.
 */
export function isActiveDirectoryMember(status: unknown): boolean {
  return String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_') === 'ACTIVE';
}

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  ACCOUNT_DELETED: 'Account Deleted',
  PENDING_DELETION: 'Pending Deletion',
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  REJECTED: 'Rejected',
};

export function formatAccountStatus(status: unknown): string {
  const normalized = String(status || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ACCOUNT_STATUS_LABELS[normalized] || String(status || '');
}
