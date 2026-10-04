type BvDirectoryUser = {
  isBvMember?: boolean | null;
  bvRegistrationStatus?: string | null;
  bvGroupId?: string | null;
  isBvAdmin?: boolean | null;
  isBvSuperAdmin?: boolean | null;
  isBvSupervisor?: boolean | null;
  isBvMentor?: boolean | null;
  isBvFacilitator?: boolean | null;
  isBvsl?: boolean | null;
  isBvSubFacilitator?: boolean | null;
};

/**
 * PW account approval stores the approving admin on bvReportingAdminId so the
 * person appears in that admin's directory. That link is not Bhakti Vriksha
 * membership. Role, parent, and group are shown only after the person has an
 * approved registration, a reading-group placement, or an assigned BV role.
 */
export function isBhaktiVrikshaDirectoryMember(user: BvDirectoryUser | null | undefined): boolean {
  if (!user) return false;
  if (user.isBvMember === true) return true;
  if (String(user.bvRegistrationStatus || '').trim() === 'Approved') return true;
  if (String(user.bvGroupId || '').trim()) return true;
  return !!(
    user.isBvAdmin ||
    user.isBvSuperAdmin ||
    user.isBvSupervisor ||
    user.isBvMentor ||
    user.isBvFacilitator ||
    user.isBvsl ||
    user.isBvSubFacilitator
  );
}
