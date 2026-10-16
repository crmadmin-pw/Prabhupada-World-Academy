import { bvUserAliases, resolveBvUsersByAliases } from './bvGroupMemberScope';

export type GroupFacilitator = {
  id: string;
  userId: string;
  name: string;
};

/** Flatten a stored id or name, including values saved as an array. */
export function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(textList);
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

/** Keep array positions, including blanks, so leader, id, and name stay aligned. */
function slotList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item ?? '').trim());
  const text = String(value ?? '').trim();
  return text ? [text] : [];
}

/**
 * One facilitator is stored as parallel strings (`bvslLeader` is the document
 * id, `bvslId` is the public user id). Several facilitators are stored as
 * parallel arrays in that same order.
 */
export function readGroupFacilitators(group: {
  bvslLeader?: unknown;
  bvslId?: unknown;
  bvslName?: unknown;
} | null | undefined): GroupFacilitator[] {
  if (!group) return [];
  const leaders = slotList(group.bvslLeader);
  const ids = slotList(group.bvslId);
  const names = slotList(group.bvslName);
  const count = Math.max(leaders.length, ids.length, names.length);
  const facilitators: GroupFacilitator[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = leaders[index] || '';
    const userId = ids[index] || '';
    const name = names[index] || '';
    if (!id && !userId && !name) continue;
    facilitators.push({ id, userId, name });
  }
  return expandCommaSeparatedFacilitator(facilitators);
}

/** Older groups stored several facilitators in one comma-separated string. */
function splitStoredList(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean);
}

function expandCommaSeparatedFacilitator(facilitators: GroupFacilitator[]): GroupFacilitator[] {
  if (facilitators.length !== 1) return facilitators;
  const one = facilitators[0];
  const ids = splitStoredList(one.id);
  const userIds = splitStoredList(one.userId);
  const names = splitStoredList(one.name);
  const count = Math.max(ids.length, userIds.length, names.length);
  if (count <= 1) return facilitators;
  const expanded: GroupFacilitator[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = ids.length === count ? ids[index] : '';
    const userId = userIds.length === count ? userIds[index] : '';
    const name = names.length === count ? names[index] : '';
    if (!id && !userId && !name) continue;
    expanded.push({ id, userId, name });
  }
  return expanded.length > 0 ? expanded : facilitators;
}

export function facilitatorIdentityKeys(facilitator: {
  id?: string;
  userId?: string;
  name?: string;
  email?: string;
}): string[] {
  return [facilitator.id, facilitator.userId, facilitator.email, facilitator.name]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sub-facilitators use the same parallel-field shape as facilitators.
 * One RGSF stays a string. Several RGSFs stay aligned arrays.
 */
export function readGroupSubFacilitators(group: {
  subFacilitatorId?: unknown;
  rgsfId?: unknown;
  subFacilitator?: unknown;
} | null | undefined): GroupFacilitator[] {
  if (!group) return [];
  const leaders = slotList(group.subFacilitatorId);
  const ids = slotList(group.rgsfId);
  const names = slotList(group.subFacilitator);
  const count = Math.max(leaders.length, ids.length, names.length);
  const facilitators: GroupFacilitator[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = leaders[index] || '';
    const userId = ids[index] || '';
    const name = names[index] || '';
    if (!id && !userId && !name) continue;
    facilitators.push({ id, userId, name });
  }
  return facilitators;
}

export function subFacilitatorWrite(facilitators: GroupFacilitator[]): {
  subFacilitatorId: string | string[];
  rgsfId: string | string[];
  subFacilitator: string | string[];
} {
  if (facilitators.length === 0) return { subFacilitatorId: '', rgsfId: '', subFacilitator: '' };
  if (facilitators.length === 1) {
    const one = facilitators[0];
    return {
      subFacilitatorId: one.id,
      rgsfId: one.userId || one.id,
      subFacilitator: one.name,
    };
  }
  return {
    subFacilitatorId: facilitators.map(item => item.id),
    rgsfId: facilitators.map(item => item.userId || item.id),
    subFacilitator: facilitators.map(item => item.name),
  };
}

export function groupHasSubFacilitator(
  group: { subFacilitatorId?: unknown; rgsfId?: unknown; subFacilitator?: unknown },
  aliases: Set<string>,
): boolean {
  return readGroupSubFacilitators(group).some(item =>
    facilitatorIdentityKeys(item).some(key => aliases.has(key)),
  );
}

export function facilitatorWrite(facilitators: GroupFacilitator[]): {
  bvslLeader: string | string[];
  bvslId: string | string[];
  bvslName: string | string[];
} {
  if (facilitators.length === 0) return { bvslLeader: '', bvslId: '', bvslName: '' };
  if (facilitators.length === 1) {
    const one = facilitators[0];
    return {
      bvslLeader: one.id,
      bvslId: one.userId || one.id,
      bvslName: one.name,
    };
  }
  return {
    bvslLeader: facilitators.map(item => item.id),
    bvslId: facilitators.map(item => item.userId || item.id),
    bvslName: facilitators.map(item => item.name),
  };
}

export function groupHasFacilitator(
  group: { bvslLeader?: unknown; bvslId?: unknown; bvslName?: unknown },
  aliases: Set<string>,
): boolean {
  return readGroupFacilitators(group).some(item =>
    facilitatorIdentityKeys(item).some(key => aliases.has(key)),
  );
}

/** An RGF or RGSF belongs to the groups they facilitate, not to a group they were removed from. */
export function isReadingGroupStaff(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return user?.isBvFacilitator === true
    || user?.isBvsl === true
    || user?.isBvSubFacilitator === true
    || ['RGF', 'BVSL', 'FACILITATOR', 'RGSF', 'SUB_FACILITATOR'].includes(role);
}

export type FacilitatorBadge = 'RGF' | 'RGSF';

function commaValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(commaValues);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(',').map(item => item.trim()).filter(Boolean);
}

function aliasSet(values: unknown[]): Set<string> {
  return new Set(values.flatMap(commaValues).map(value => value.toLowerCase()));
}

/**
 * RGFs and RGSFs assigned on the group, including people who have no
 * membership row. Inactive profiles are left out.
 */
export async function loadGroupFacilitators(group: any): Promise<Array<{ user: any; badges: FacilitatorBadge[] }>> {
  const rgfIds = aliasSet([group?.bvslLeader, group?.bvslId]);
  const rgfNames = aliasSet([group?.bvslName]);
  const rgsfIds = aliasSet([group?.subFacilitatorId, group?.rgsfId, group?.subFacilitator]);
  const lookupAliases = [...rgfIds, ...(rgfIds.size > 0 ? [] : [...rgfNames]), ...rgsfIds];
  if (lookupAliases.length === 0) return [];

  const users = await resolveBvUsersByAliases(lookupAliases, [
    'id', 'userId', 'fullName', 'email', 'phone', 'ashrayLevel', 'status',
    'bvGroupId', 'isBvMember',
  ]);
  const rgfAliases = rgfIds.size > 0 ? rgfIds : rgfNames;
  const roster: Array<{ user: any; badges: FacilitatorBadge[] }> = [];
  for (const user of users) {
    if (user?.status && String(user.status).toLowerCase() !== 'active') continue;
    const aliases = new Set(bvUserAliases(user));
    const badges: FacilitatorBadge[] = [];
    if ([...rgfAliases].some(alias => aliases.has(alias))) badges.push('RGF');
    if ([...rgsfIds].some(alias => aliases.has(alias))) badges.push('RGSF');
    if (badges.length > 0) roster.push({ user, badges });
  }
  return roster;
}

export function facilitatorRoleLabel(badges: FacilitatorBadge[]): FacilitatorBadge | null {
  if (badges.includes('RGF')) return 'RGF';
  if (badges.includes('RGSF')) return 'RGSF';
  return null;
}

export function joinFacilitatorNames(names: Array<string | null | undefined>): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const text = String(name || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique.join(', ');
}
