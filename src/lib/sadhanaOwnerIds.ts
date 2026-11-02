import { Users } from '@/lib/backend-sdk';

/** Entry owner aliases that are verified to belong to the signed-in member. */
export async function sadhanaOwnerIds(
  authenticatedId: string,
  authUid: string | undefined,
  authEmail: string | undefined,
  userRecord: { userId?: string; email?: string } | null | undefined,
  requestedId: string | undefined,
): Promise<string[]> {
  const ids = [authenticatedId, authUid, userRecord?.userId];
  const request = String(requestedId || '').trim();
  if (request && !ids.includes(request)) {
    const requestedUser = await Users.findOne({ filters: { userId: request }, fields: ['id', 'userId', 'email'] })
      || await Users.findOne({ id: request, fields: ['id', 'userId', 'email'] });
    const currentEmail = String(userRecord?.email || authEmail || '').trim().toLowerCase();
    if (requestedUser && currentEmail && String(requestedUser.email || '').trim().toLowerCase() === currentEmail) {
      ids.push(requestedUser.id, requestedUser.userId);
    }
  }
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id))];
}
