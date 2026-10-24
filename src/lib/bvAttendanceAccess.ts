import { BvGroups, Guides, Users } from '@/lib/backend-sdk';
import { bvUserAliases, resolveBvScopedGroups } from '@/lib/bvGroupMemberScope';
import { isReadingGroupStaff } from '@/lib/bvGroupFacilitators';
import { getRefId } from '@/lib/userUtils';

const USER_FIELDS = [
  'id', 'userId', 'email', 'fullName', 'displayName', 'name', 'status', 'role',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
  'isBvFacilitator', 'isBvsl', 'isBvSubFacilitator',
  'bvGroupId', 'bvGroupName', 'bvReportingFacilitatorId',
];

const GUIDE_FIELDS = ['id', 'guideId', 'email', 'fullName'];

/** Stored facilitator ids may be one string, a list, a comma-separated string, or a reference object. */
function identityTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identityTokens);
  if (value && typeof value === 'object') {
    const id = getRefId(value);
    if (!id || id === '[object Object]') return [];
    return identityTokens(id);
  }
  if (value == null) return [];
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(identityTokens);
    } catch { /* a normal id or name */ }
  }
  return text.split(',').map(part => part.trim()).filter(Boolean);
}

function addAliases(target: Set<string>, value: unknown) {
  for (const token of identityTokens(value)) target.add(token.toLowerCase());
}

function uniqueUsers(users: any[]): any[] {
  const unique = new Map<string, any>();
  for (const user of users) {
    if (user?.id) unique.set(String(user.id), user);
  }
  return [...unique.values()];
}

async function findUsersByToken(token: string): Promise<any[]> {
  const key = token.trim();
  if (!key) return [];
  const emailKey = key.toLowerCase();
  const results = await Promise.all([
    Users.findOne({ id: key, fields: USER_FIELDS }),
    Users.findOne({ filters: { userId: key }, fields: USER_FIELDS }),
    Users.findOne({ filters: { email: key }, fields: USER_FIELDS }),
    emailKey === key ? Promise.resolve(null) : Users.findOne({ filters: { email: emailKey }, fields: USER_FIELDS }),
    Users.findOne({ filters: { firebaseUid: key }, fields: USER_FIELDS }),
    Users.findOne({ filters: { authUid: key }, fields: USER_FIELDS }),
  ]);
  return uniqueUsers(results.filter(Boolean));
}

type CallerAccess = { aliases: Set<string>; profile: any | null };

async function loadCallerAccess(caller: any): Promise<CallerAccess> {
  const aliases = new Set<string>();
  addAliases(aliases, [
    caller?.id, caller?.uid, caller?.userId, caller?.email, caller?.fullName, caller?.name,
  ]);
  const seeds = identityTokens([caller?.id, caller?.uid, caller?.userId, caller?.email]);
  const found = uniqueUsers((await Promise.all(seeds.map(findUsersByToken))).flat());
  const complete = found.filter(user => user?.userId && user?.status);
  const profiles = complete.length ? complete : found;
  for (const profile of profiles) bvUserAliases(profile).forEach(alias => aliases.add(alias));
  const profile = [...profiles].sort((left, right) => profileQuality(right) - profileQuality(left))[0] || null;
  return { aliases, profile };
}

function profileQuality(user: any): number {
  return (user?.userId ? 4 : 0) + (user?.status ? 2 : 0) + (user?.fullName ? 1 : 0);
}

function facilitatorTokens(group: any): string[] {
  return identityTokens([
    group?.bvslLeader, group?.bvslId, group?.bvslName,
    group?.rgsfId, group?.subFacilitatorId, group?.subFacilitator,
  ]);
}

async function guideMatchesCaller(token: string, callerAliases: Set<string>): Promise<boolean> {
  if (token.includes(' ')) return false;
  const email = token.includes('@') ? token.toLowerCase() : '';
  const guide = await Guides.findOne({ id: token, fields: GUIDE_FIELDS })
    || await Guides.findOne({ filters: { guideId: token }, fields: GUIDE_FIELDS })
    || (email ? await Guides.findOne({ filters: { email }, fields: GUIDE_FIELDS }) : null);
  if (!guide) return false;
  const guideAliases = [guide.id, guide.guideId, guide.email, guide.fullName]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (guideAliases.some(alias => callerAliases.has(alias))) return true;
  if (!guide.email) return false;
  const linked = await Users.findOne({
    filters: { email: String(guide.email).toLowerCase() },
    fields: USER_FIELDS,
  }) || await Users.findOne({ filters: { email: guide.email }, fields: USER_FIELDS });
  return !!linked && bvUserAliases(linked).some(alias => callerAliases.has(alias));
}

async function tokensMatchCaller(tokens: string[], callerAliases: Set<string>): Promise<boolean> {
  if (tokens.some(token => callerAliases.has(token.toLowerCase()))) return true;
  for (const token of tokens) {
    const people = await findUsersByToken(token);
    if (people.some(person => bvUserAliases(person).some(alias => callerAliases.has(alias)))) return true;
    if (await guideMatchesCaller(token, callerAliases)) return true;
  }
  return false;
}

/**
 * Every RGF stored on the group may mark attendance, not only the first.
 * Sign-in ids, public user ids, emails, legacy guide ids, and names all count.
 */
export async function callerFacilitatesReadingGroup(group: any, caller: any): Promise<boolean> {
  const access = await loadCallerAccess(caller);
  if (access.aliases.size === 0) return false;
  return tokensMatchCaller(facilitatorTokens(group), access.aliases);
}

/** Attendance writes use the same assignments as the group list. */
async function assignedStaffCanRecord(group: any, caller: any, access: CallerAccess): Promise<boolean> {
  if (!isReadingGroupStaff(access.profile) && !isReadingGroupStaff(caller)) return false;
  const groups = await resolveBvScopedGroups({ ...caller, ...access.profile });
  return groups.some(allowed => allowed.id === String(group.id));
}

export async function callerCanRecordGroupAttendance(group: any, caller: any): Promise<boolean> {
  const access = await loadCallerAccess(caller);
  if (access.aliases.size === 0) return false;
  if (await tokensMatchCaller(facilitatorTokens(group), access.aliases)) return true;
  return assignedStaffCanRecord(group, caller, access);
}

/** The attendance screen sends the group document id. A public groupId is only
 * the fallback, so another group's public id cannot take its place. */
export async function findAttendanceGroup(requestedId: string, fields: string[]) {
  const byDocument = await BvGroups.findOne({ id: requestedId, fields });
  if (byDocument) return byDocument;
  return BvGroups.findOne({ filters: { groupId: requestedId }, fields });
}
