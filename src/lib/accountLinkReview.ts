import { AccountLinkRequests, AppError, Users } from '@/lib/backend-sdk';
import type { ApiDatabaseUser } from '@/lib/apiAuthorization';
import { publishCollectionRevision, publishUsersRevision } from '@/lib/publishUsersRevision';
import { serverCacheInvalidate } from '@/lib/serverCache';

export type AccountLinkHold = 'account_link_pending' | 'account_link_rejected';

export interface AccountLinkCandidate {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  segment: string;
  alreadyLinked: boolean;
}

export interface AccountLinkRequestRecord {
  id: string;
  authUid: string;
  email: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  candidateProfileIds: string[];
  candidates: AccountLinkCandidate[];
  bareRecordId: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  approvedProfileId?: string | null;
  removedBareRecordId?: string | null;
  notes?: string | null;
}

const LINKED_UID_FIELDS = ['firebaseUid', 'authUid', 'firebaseAuthUid'] as const;

export function normalizeLoginEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function accountLinkRequestId(authUid: string): string {
  return `acct-link-${String(authUid || '').trim()}`;
}

export function isCompleteProfile(record: { userId?: unknown; status?: unknown } | null | undefined): boolean {
  return !!(record?.userId && record?.status);
}

/** A login may use a profile only when that profile was already bound to this Firebase uid. */
export function isLoginLinkedToProfile(
  record: { id?: unknown; firebaseUid?: unknown; authUid?: unknown; firebaseAuthUid?: unknown } | null | undefined,
  authUid: string,
): boolean {
  const uid = String(authUid || '').trim();
  if (!record || !uid) return false;
  if (String(record.id || '') === uid) return true;
  return LINKED_UID_FIELDS.some(field => record[field] && String(record[field]) === uid);
}

export function canReviewAccountLinks(user: {
  capabilities?: readonly string[];
  role?: unknown;
  normalizedRole?: unknown;
  isBvSuperAdmin?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.capabilities?.includes('*') || user.capabilities?.includes('system.admin')) return true;
  const role = String(user.normalizedRole || user.role || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'PW_ADMIN' || user.isBvSuperAdmin === true;
}

function summarizeCandidate(record: any, authUid: string): AccountLinkCandidate {
  const linkedUid = LINKED_UID_FIELDS.map(field => record?.[field]).find(value => value != null && String(value).trim());
  return {
    id: String(record.id),
    userId: String(record.userId || ''),
    fullName: String(record.fullName || record.name || ''),
    email: normalizeLoginEmail(record.email || ''),
    role: String(record.role || ''),
    status: String(record.status || ''),
    segment: String(record.segment || ''),
    alreadyLinked: !!linkedUid && String(linkedUid) !== authUid,
  };
}

async function findEmailProfiles(email: string): Promise<any[]> {
  const normalized = normalizeLoginEmail(email);
  if (!normalized) return [];
  const lookups = [Users.findAll({ filters: { email: normalized }, limit: 10 })];
  const original = String(email || '').trim();
  if (original && original !== normalized) {
    lookups.push(Users.findAll({ filters: { email: original }, limit: 10 }));
  }
  const results = await Promise.all(lookups);
  const seen = new Set<string>();
  const profiles = [];
  for (const result of results) {
    for (const record of result.records || []) {
      if (!record?.id || seen.has(String(record.id))) continue;
      if (!isCompleteProfile(record)) continue;
      if (normalizeLoginEmail(record.email || '') !== normalized) continue;
      seen.add(String(record.id));
      profiles.push(record);
    }
  }
  return profiles;
}

export async function findUnlinkedEmailProfiles(email: string, authUid: string): Promise<any[]> {
  const profiles = await findEmailProfiles(email);
  return profiles.filter(record => !isLoginLinkedToProfile(record, authUid));
}

function sameIds(left: unknown, right: string[]): boolean {
  const current = Array.isArray(left) ? left.map(value => String(value)).sort() : [];
  return current.join('\0') === [...right].sort().join('\0');
}

/**
 * Record that this login's email matches one or more profiles.
 * Does not attach the login or delete any user record.
 */
export async function ensureAccountLinkReview(input: {
  authUid: string;
  email: string;
  bareRecordId?: string | null;
}): Promise<AccountLinkHold | null> {
  const authUid = String(input.authUid || '').trim();
  const email = normalizeLoginEmail(input.email || '');
  if (!authUid || !email) return null;

  const matches = await findUnlinkedEmailProfiles(email, authUid);
  if (matches.length === 0) return null;

  const candidates = matches.map(record => summarizeCandidate(record, authUid));
  const candidateProfileIds = candidates.map(candidate => candidate.id);
  const bareRecordId = input.bareRecordId && String(input.bareRecordId) === authUid ? authUid : null;
  const id = accountLinkRequestId(authUid);
  const existing = await AccountLinkRequests.findOne({ id }) as AccountLinkRequestRecord | null;
  const now = new Date().toISOString();

  if (existing?.status === 'Rejected') {
    if (!sameIds(existing.candidateProfileIds, candidateProfileIds) || normalizeLoginEmail(existing.email || '') !== email) {
      await AccountLinkRequests.update({
        id,
        record: { email, candidateProfileIds, candidates, bareRecordId, updatedAt: now },
      });
      await publishCollectionRevision('AccountLinkRequests', id, existing as unknown as Record<string, unknown>);
    }
    return 'account_link_rejected';
  }

  const pendingUnchanged = existing?.status === 'Pending'
    && normalizeLoginEmail(existing.email || '') === email
    && sameIds(existing.candidateProfileIds, candidateProfileIds)
    && (existing.bareRecordId || null) === bareRecordId;
  if (pendingUnchanged) return 'account_link_pending';

  const record: AccountLinkRequestRecord = {
    id,
    authUid,
    email,
    status: 'Pending',
    candidateProfileIds,
    candidates,
    bareRecordId,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    reviewedBy: null,
    reviewedAt: null,
    approvedProfileId: null,
    removedBareRecordId: null,
    notes: '',
  };
  if (existing) await AccountLinkRequests.update({ id, record });
  else await AccountLinkRequests.create({ record });
  await publishCollectionRevision('AccountLinkRequests', id, existing as unknown as Record<string, unknown> | null);
  return 'account_link_pending';
}

/**
 * Resolve the profile this login is already allowed to use.
 * An email match is queued for review and is not returned as the signed-in person.
 */
export async function resolveAuthenticatedProfile(authUid: string, email: string): Promise<ApiDatabaseUser | null> {
  const uid = String(authUid || '').trim();
  if (!uid) return null;

  const uidRecord = await Users.findOne({ id: uid });
  if (isCompleteProfile(uidRecord)) return uidRecord;

  const linked = await Users.findOne({ filters: { firebaseUid: uid } });
  if (isCompleteProfile(linked) && isLoginLinkedToProfile(linked, uid)) return linked;

  await ensureAccountLinkReview({
    authUid: uid,
    email,
    bareRecordId: uidRecord?.id ? String(uidRecord.id) : null,
  });
  return uidRecord || null;
}

async function removeEmptyLoginStub(authUid: string, profileId: string): Promise<string | null> {
  if (!authUid || authUid === profileId) return null;
  const stub = await Users.findOne({ id: authUid });
  if (!stub || String(stub.id) !== authUid || String(stub.id) === profileId) return null;
  if (stub.userId || stub.status) return null;
  await Users.delete({ id: authUid });
  return authUid;
}

export async function reviewAccountLinkRequest(input: {
  requestId: string;
  action: 'approve' | 'reject' | 'reopen';
  profileId?: string;
  notes?: string;
  reviewerId: string;
}): Promise<{ success: true; status: 'Approved' | 'Rejected' | 'Pending' }> {
  const request = await AccountLinkRequests.findOne({ id: input.requestId }) as AccountLinkRequestRecord | null;
  if (!request) throw new AppError({ code: 'NOT_FOUND', message: 'Account link request not found' });

  const now = new Date().toISOString();
  const notes = String(input.notes || '').trim();

  if (input.action === 'reopen') {
    if (request.status !== 'Rejected') {
      throw new AppError({ code: 'CONFLICT', message: 'Only a rejected link can be opened for review again' });
    }
    await AccountLinkRequests.update({
      id: request.id,
      record: {
        status: 'Pending',
        updatedAt: now,
        reviewedBy: null,
        reviewedAt: null,
        approvedProfileId: null,
        notes,
      },
    });
    await publishCollectionRevision('AccountLinkRequests', request.id, request as unknown as Record<string, unknown>);
    return { success: true, status: 'Pending' };
  }

  if (request.status !== 'Pending') {
    throw new AppError({ code: 'CONFLICT', message: 'Request already reviewed' });
  }

  if (input.action === 'reject') {
    await AccountLinkRequests.update({
      id: request.id,
      record: {
        status: 'Rejected',
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        updatedAt: now,
        notes,
      },
    });
    await publishCollectionRevision('AccountLinkRequests', request.id, request as unknown as Record<string, unknown>);
    return { success: true, status: 'Rejected' };
  }

  const profileId = String(input.profileId || '').trim();
  if (!profileId || !request.candidateProfileIds?.includes(profileId)) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Choose one of the profiles listed on this request' });
  }

  const profile = await Users.findOne({ id: profileId });
  if (!isCompleteProfile(profile)) {
    throw new AppError({ code: 'NOT_FOUND', message: 'That profile is no longer available to link' });
  }
  if (normalizeLoginEmail(profile.email || '') !== normalizeLoginEmail(request.email || '')) {
    throw new AppError({ code: 'CONFLICT', message: 'That profile email no longer matches this login' });
  }
  const existingLink = String(profile.firebaseUid || profile.authUid || profile.firebaseAuthUid || '');
  if (existingLink && existingLink !== request.authUid) {
    throw new AppError({ code: 'CONFLICT', message: 'That profile is already linked to a different login' });
  }

  await Users.update({
    id: profile.id,
    record: { firebaseUid: request.authUid, authLinkedAt: now },
  });
  let removedBareRecordId: string | null = null;
  try {
    removedBareRecordId = await removeEmptyLoginStub(request.authUid, profile.id);
  } catch (error) {
    console.warn('[account-link] Login placeholder could not be removed after approval', error);
  }

  await AccountLinkRequests.update({
    id: request.id,
    record: {
      status: 'Approved',
      approvedProfileId: profile.id,
      reviewedBy: input.reviewerId,
      reviewedAt: now,
      updatedAt: now,
      removedBareRecordId,
      notes,
    },
  });
  serverCacheInvalidate(`user_profile:${profile.id}`);
  serverCacheInvalidate(`user_profile:${request.authUid}`);
  await publishUsersRevision(profile.id, profile);
  await publishCollectionRevision('AccountLinkRequests', request.id, request as unknown as Record<string, unknown>);
  return { success: true, status: 'Approved' };
}
