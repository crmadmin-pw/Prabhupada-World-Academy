/** Shared server-side meeting visibility rules.
 *
 * A person can be represented by a Firebase UID, a database document ID, a
 * legacy userId, or an email address. Meetings created across those migrations
 * contain a mixture of those identifiers, so invitee checks must compare all
 * of them consistently.
 */

type UserLike = Record<string, any> | null | undefined;

export type MeetingViewer = {
  department: 'FOLK' | 'PW' | null;
  canViewAllMeetings: boolean;
  isReadOnlySadhanaMentor: boolean;
  identityKeys: Set<string>;
  names: Set<string>;
  email: string;
};

export function normalizeMeetingDepartment(value: unknown): 'FOLK' | 'PW' | null {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  if (normalized === 'FOLK') return 'FOLK';
  if (normalized === 'PW' || normalized === 'PRABHUPADAWORLD') return 'PW';
  return null;
}

function normalizedRole(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function identityValues(...users: UserLike[]): Set<string> {
  const keys = new Set<string>();
  for (const user of users) {
    if (!user) continue;
    for (const value of [user.id, user.userId, user.email, user.uid, user.authUid, user.firebaseUid]) {
      const key = String(value || '').trim().toLowerCase();
      if (key) keys.add(key);
    }
  }
  return keys;
}

function personNames(...users: UserLike[]): Set<string> {
  const names = new Set<string>();
  for (const user of users) {
    if (!user) continue;
    for (const value of [user.fullName, user.displayName, user.name]) {
      const name = String(value || '').trim().toLowerCase();
      if (name) names.add(name);
    }
  }
  return names;
}

export function getMeetingViewer(contextUser: UserLike, storedUser: UserLike): MeetingViewer {
  // The database profile takes precedence; it is the source of truth when a
  // token still contains a legacy department or role from a prior assignment.
  const department = normalizeMeetingDepartment(storedUser?.segment)
    || normalizeMeetingDepartment(contextUser?.segment);
  const roles = [normalizedRole(storedUser?.role), normalizedRole(contextUser?.role)];
  const isSadhanaMentor = !!(
    storedUser?.isSadhanaMentor || contextUser?.isSadhanaMentor ||
    roles.includes('SADHANA_MENTOR')
  );
  const isReadOnlySadhanaMentor = department === 'PW' && isSadhanaMentor;
  const isAdmin = !!(
    storedUser?.isBvSuperAdmin || contextUser?.isBvSuperAdmin ||
    roles.some(role => ['SUPER_ADMIN', 'SUPER_GUIDE'].includes(role))
  );

  return {
    department,
    isReadOnlySadhanaMentor,
    canViewAllMeetings: isAdmin && !isReadOnlySadhanaMentor,
    identityKeys: identityValues(storedUser, contextUser),
    names: personNames(storedUser, contextUser),
    email: String(storedUser?.email || contextUser?.email || '').trim().toLowerCase(),
  };
}

function inviteeIdentity(invitee: any): { id: string; email: string; name: string } {
  return {
    id: String(invitee?.userId || '').trim().toLowerCase(),
    email: String(invitee?.email || '').trim().toLowerCase(),
    name: String(invitee?.fullName || '').trim().toLowerCase(),
  };
}

function identityMatchesViewer(id: string, email: string, viewer: MeetingViewer): boolean {
  return viewer.identityKeys.has(id) || (!!viewer.email && email === viewer.email);
}

/** A saved participant can carry another person's account id. That name wins. */
function listedAsSomeoneElse(invitee: any, viewer: MeetingViewer): boolean {
  const name = inviteeIdentity(invitee).name;
  if (!name || !viewer.names || viewer.names.size === 0) return false;
  return !viewer.names.has(name);
}

export function isMeetingVisibleToViewer(meeting: any, viewer: MeetingViewer): boolean {
  if (viewer.identityKeys.has(String(meeting?.createdByUserId || '').trim().toLowerCase())) return true;
  const invitees = Array.isArray(meeting?.invitees) ? meeting.invitees : [];
  const inviteeIds = Array.isArray(meeting?.inviteeUserIds) ? meeting.inviteeUserIds : [];
  if (inviteeIds.some((id: unknown) => {
    const key = String(id || '').trim().toLowerCase();
    if (!viewer.identityKeys.has(key)) return false;
    const linked = invitees.filter((invitee: any) => {
      const identity = inviteeIdentity(invitee);
      return identity.id === key || identity.email === key;
    });
    return linked.length === 0 || linked.some((invitee: any) => !listedAsSomeoneElse(invitee, viewer));
  })) return true;

  return invitees.some((invitee: any) => {
    if (listedAsSomeoneElse(invitee, viewer)) return false;
    const identity = inviteeIdentity(invitee);
    return identityMatchesViewer(identity.id, identity.email, viewer) || viewer.names.has(identity.name);
  });
}
