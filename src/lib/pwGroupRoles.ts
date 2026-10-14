export type PwGroupRole = 'FACILITATOR' | 'SUB_FACILITATOR' | 'MEMBER';

export type PwGroupRoleOption = {
  id: string;
  groupId?: string;
  groupName: string;
  isActive?: boolean;
  rgfIds?: string[];
  rgsfIds?: string[];
  facilitatorIds?: string[];
};

type PersonRef = {
  id?: string;
  userId?: string;
  userDbId?: string;
  email?: string;
  fullName?: string;
  bvGroupId?: unknown;
};

function refsOf(values: unknown[]): Set<string> {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const text = String(value ?? '').trim().toLowerCase();
    if (text) refs.add(text);
  };
  values.forEach(visit);
  return refs;
}

function listed(ids: string[] | undefined, refs: Set<string>): boolean {
  return (ids || []).some(id => refs.has(String(id).trim().toLowerCase()));
}

/** Groups this person already belongs to, with the role stored on that group. */
export function pwReadingGroups(user: PersonRef, groups: PwGroupRoleOption[]): Array<PwGroupRoleOption & { role: PwGroupRole }> {
  const refs = refsOf([user.id, user.userId, user.userDbId, user.email, user.fullName]);
  const memberIds = refsOf([user.bvGroupId]);
  const found: Array<PwGroupRoleOption & { role: PwGroupRole }> = [];
  for (const group of groups) {
    if (group.isActive === false) continue;
    const keys = refsOf([group.id, group.groupId]);
    const onRgf = listed(group.rgfIds, refs);
    const onRgsf = listed(group.rgsfIds, refs);
    const legacyLeader = !group.rgfIds && !group.rgsfIds && listed(group.facilitatorIds, refs);
    const onMember = [...keys].some(key => memberIds.has(key));
    if (!onRgf && !onRgsf && !legacyLeader && !onMember) continue;
    const role: PwGroupRole = onRgf || legacyLeader ? 'FACILITATOR' : onRgsf ? 'SUB_FACILITATOR' : 'MEMBER';
    found.push({ ...group, role });
  }
  return found;
}
