import { getAuth } from 'firebase-admin/auth';
import type { UserRecord } from 'firebase-admin/auth';
import type { DocumentData, Firestore, QueryDocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { getFirestoreDb } from '@/lib/backend-sdk';
import { deriveApiCapabilities } from '@/lib/apiAuthorization';
import { listedReadingRoles } from '@/lib/bvGroupFacilitators';
import { accountLinkRequestId, isCompleteProfile, normalizeLoginEmail } from '@/lib/accountLinkReview';
import { publishCollectionRevision, publishUsersRevision } from '@/lib/publishUsersRevision';
import { serverCacheInvalidate } from '@/lib/serverCache';

const UID_FIELDS = ['uid', 'firebaseUid', 'authUid', 'firebaseAuthUid', 'firebaseUserId', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'] as const;
const ELEVATED_FLAGS = ['isBvAdmin', 'isBvSuperAdmin', 'isBvSupervisor', 'isBvMentor', 'isBvFacilitator', 'isBvSubFacilitator', 'isBvsl', 'isSadhanaMentor', 'isServiceAllocator', 'isCleanlinessManager', 'isFolkLead', 'isTripCoordinator', 'isPwAdmin'] as const;

type Identity = { uid: string; email: string; emailVerified: boolean };
type Dependencies = { db: Firestore; auth: { getUserByEmail(email: string): Promise<UserRecord>; getUser(uid: string): Promise<UserRecord> } };
type RecoveryProfile = DocumentData & { id: string; userId?: string; status?: string; role?: string };

/** Link an unambiguous ordinary member only. All checks and both writes are
 * made in one transaction; records belonging to a login stub are retained. */
export async function recoverVerifiedAccount(identity: Identity, dependencies?: Dependencies): Promise<DocumentData | null> {
  const uid = String(identity.uid || '').trim();
  const email = normalizeLoginEmail(identity.email);
  if (!uid || !email || identity.emailVerified !== true) return null;
  const db: Firestore | null = dependencies?.db ?? getFirestoreDb();
  if (!db) return null;
  const auth = dependencies?.auth ?? getAuth();

  // Firebase Auth is authoritative for current ownership and verification.
  const login = await auth.getUserByEmail(email);
  if (login.uid !== uid || login.disabled || login.emailVerified !== true || normalizeLoginEmail(login.email || '') !== email) return null;

  const outcome = await db.runTransaction(async (tx: Transaction) => {
    // Firestore equality is case sensitive. Read the directory in the
    // transaction so mixed-case legacy duplicates cannot be missed.
    const snapshot = await tx.get(db.collection('Users').select('email', 'userId', 'status', ...UID_FIELDS));
    const users: DocumentData[] = snapshot.docs.map((doc: QueryDocumentSnapshot) => ({ ...doc.data(), id: doc.id }));
    const stub = users.find(user => user.id === uid);
    if (isCompleteProfile(stub)) return null;
    if (stub && (normalizeLoginEmail(stub.email || '') !== email || stub.userId || stub.status)) return null;
    const matches = users.filter(user => user.id !== uid && normalizeLoginEmail(user.email || '') === email);
    if (matches.length !== 1) return null;
    const profileSnapshot = await tx.get(db.collection('Users').doc(matches[0].id));
    if (!profileSnapshot.exists) return null;
    const profile: RecoveryProfile = { ...profileSnapshot.data(), id: profileSnapshot.id };
    const role = String(profile.role || '').trim().toUpperCase();
    if (!isCompleteProfile(profile) || String(profile.status || '').trim().toUpperCase() !== 'ACTIVE' || role !== 'USER') return null;
    if (ELEVATED_FLAGS.some(field => profile[field] === true) || deriveApiCapabilities(profile).length) return null;
    if (UID_FIELDS.some(field => profile[field] != null && String(profile[field]).trim())) return null;
    if (users.some(user => user.id !== profile.id && user.id !== uid && (String(user.userId || '') === String(profile.userId) || UID_FIELDS.some(field => String(user[field] || '') === uid)))) return null;

    const requestRef = db.collection('AccountLinkRequests').doc(accountLinkRequestId(uid));
    const requestSnapshot = await tx.get(requestRef);
    const request = requestSnapshot.exists ? requestSnapshot.data() : null;
    if (request && (request.status !== 'Pending' || normalizeLoginEmail(request.email || '') !== email || request.authUid !== uid)) return null;
    if (request && (!Array.isArray(request.candidateProfileIds) || request.candidateProfileIds.length !== 1 || request.candidateProfileIds[0] !== profile.id)) return null;

    const owners = [...new Set([uid, profile.id, String(profile.userId), email])];
    const holds = await tx.get(db.collection('AccountDeletionHolds').where('ownerId', 'in', owners).limit(1));
    if (!holds.empty) return null;
    const groups = await tx.get(db.collection('BvGroups').select('bvslLeader', 'bvslId', 'bvslName', 'subFacilitatorId', 'rgsfId', 'subFacilitator'));
    if (listedReadingRoles(groups.docs.map((doc: QueryDocumentSnapshot) => doc.data()), profile).listed) return null;

    // A legacy document ID can itself be a Firebase UID. Never replace an
    // existing Auth identity, even when its link fields are empty.
    try {
      await auth.getUser(profile.id);
      return null;
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
    }

    const now = new Date().toISOString();
    tx.update(db.collection('Users').doc(profile.id), { firebaseUid: uid, authLinkedAt: now });
    tx.set(requestRef, {
      id: accountLinkRequestId(uid), authUid: uid, email, status: 'Approved',
      candidateProfileIds: [profile.id], approvedProfileId: profile.id,
      createdAt: request?.createdAt || now, updatedAt: now, reviewedAt: now,
      reviewedBy: 'automatic_verified_email', notes: 'Automatic verified email recovery',
      bareRecordId: stub?.id || null, removedBareRecordId: null,
    }, { merge: true });
    return { profile, request, now };
  });
  if (!outcome) return null;
  serverCacheInvalidate(`user_profile:${outcome.profile.id}`);
  serverCacheInvalidate(`user_profile:${uid}`);
  await publishUsersRevision(outcome.profile.id, outcome.profile);
  await publishCollectionRevision('AccountLinkRequests', accountLinkRequestId(uid), outcome.request);
  return { ...outcome.profile, firebaseUid: uid, authLinkedAt: outcome.now };
}
