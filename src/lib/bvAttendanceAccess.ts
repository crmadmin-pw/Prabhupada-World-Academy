import { Users } from '@/lib/backend-sdk';
import { bvUserAliases } from '@/lib/bvGroupMemberScope';
import { readGroupFacilitators, textList } from '@/lib/bvGroupFacilitators';

const USER_FIELDS = [
  'id', 'userId', 'email', 'fullName', 'displayName', 'name',
  'uid', 'authUid', 'firebaseUid', 'firebaseUserId', 'firebaseAuthUid',
  'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id',
];

/** Stored facilitator ids may be one string, a list, a comma-separated string, or a reference object. */
function identityTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(identityTokens);
  if (value && typeof value === 'object') {
    const record = value as { id?: unknown; path?: unknown };
    const pathId = typeof record.path === 'string' ? record.path.split('/').pop() : undefined;
    return identityTokens([record.id, pathId]);
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

async function findUser(tokens: string[]) {
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const user = await Users.findOne({ id: token, fields: USER_FIELDS })
      || await Users.findOne({ filters: { userId: token }, fields: USER_FIELDS })
      || await Users.findOne({ filters: { email: key }, fields: USER_FIELDS });
    if (user) return user;
  }
  return null;
}

/**
 * Every RGF stored on the group may mark attendance, not only the first.
 * Sign-in ids, public user ids, emails, and legacy names all count.
 */
export async function callerFacilitatesReadingGroup(group: any, caller: any): Promise<boolean> {
  const callerAliases = new Set<string>();
  addAliases(callerAliases, [
    caller?.id, caller?.uid, caller?.userId, caller?.email, caller?.fullName, caller?.name,
  ]);
  const callerRecord = await findUser(identityTokens([
    caller?.id, caller?.uid, caller?.userId, caller?.email,
  ]));
  if (callerRecord) bvUserAliases(callerRecord).forEach(alias => callerAliases.add(alias));
  if (callerAliases.size === 0) return false;

  const facilitatorTokens = identityTokens([
    ...readGroupFacilitators(group).flatMap(person => [person.id, person.userId, person.name]),
    ...textList(group?.rgsfId),
    ...textList(group?.subFacilitatorId),
    ...textList(group?.subFacilitator),
  ]);
  if (facilitatorTokens.some(token => callerAliases.has(token.toLowerCase()))) return true;

  for (const token of facilitatorTokens) {
    const person = await findUser([token]);
    if (person && bvUserAliases(person).some(alias => callerAliases.has(alias))) return true;
  }
  return false;
}
