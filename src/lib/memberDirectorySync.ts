/** Approved members the directory has not yet returned from the server.
 * Held in memory so a Members tab that is hidden, or not yet opened, can
 * show the name as soon as it renders. A full reload clears this. */
export type ApprovedDirectoryMember = {
  userId: string;
  fullName: string;
  email?: string;
  phone?: string;
  segment?: string | null;
  isPrabhupadaWorldUser?: boolean;
  ashrayLevel?: string | null;
  status?: string;
  guideId?: string | null;
  guideName?: string | null;
  sadhanaMentor?: string | null;
  bvReportingAdminId?: string | null;
  bvReportingAdminName?: string | null;
};

export const MEMBER_DIRECTORY_CHANGED_EVENT = 'pwa:member-directory-changed';

const pending = new Map<string, ApprovedDirectoryMember>();

function identityOf(user: { userId?: string; id?: string; userDbId?: string }): string[] {
  return [user.userId, user.id, user.userDbId].map(value => String(value || '').trim()).filter(Boolean);
}

export function noteApprovedDirectoryMember(member: ApprovedDirectoryMember): void {
  const userId = String(member.userId || '').trim();
  const fullName = String(member.fullName || '').trim();
  if (!userId || !fullName) return;
  pending.set(userId, { ...member, userId, fullName, status: member.status || 'ACTIVE' });
}

/** Keep a just-approved member visible until a directory response includes them.
 * Once the server list contains that member, the local hint is dropped. */
export function mergeApprovedDirectoryMembers<T extends { userId?: string; id?: string; userDbId?: string }>(
  users: T[],
  toRow: (member: ApprovedDirectoryMember) => T,
): T[] {
  const present = new Set(users.flatMap(identityOf));
  const extras: T[] = [];
  for (const [id, member] of pending) {
    const aliases = identityOf(member);
    if (aliases.some(alias => present.has(alias))) pending.delete(id);
    else extras.push(toRow(member));
  }
  return extras.length ? [...extras, ...users] : users;
}

export function publishMemberDirectoryChange(member?: ApprovedDirectoryMember): void {
  if (member) noteApprovedDirectoryMember(member);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MEMBER_DIRECTORY_CHANGED_EVENT, { detail: { member } }));
  }
}
