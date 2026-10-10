import { createHash } from 'node:crypto';
import { AppError } from '@/lib/backend-sdk';
import {
  ACCOUNT_DELETION_GRACE_MS,
  PENDING_DELETION_STATUS,
  collectStoragePaths,
  isPendingDeletion,
} from '@/lib/accountDeletionPolicy';

export interface DeletionTable {
  tableName: string;
  findOne(query: { id?: string; filters?: Record<string, unknown> }): Promise<any>;
  findAll(query?: { filters?: Record<string, unknown>; limit?: number; offset?: number }): Promise<{ records: any[]; hasMore?: boolean }>;
  create(args: { record: any }): Promise<any>;
  update(args: { id: string; record: any }): Promise<any>;
  delete(args: { id: string }): Promise<any>;
}

type OwnedLookup = { scalar: string[]; array: string[]; ratings?: boolean };

/** Collections whose rows belong to one person and must leave reports when that person leaves. */
export const OWNED_RECORD_LOOKUPS: Record<string, OwnedLookup> = {
  RentPayments: { scalar: ['user', 'userId'], array: ['user'] },
  Trips: { scalar: ['user', 'userId'], array: ['user'] },
  ServiceAllocations: { scalar: ['user', 'userId'], array: ['user'] },
  ServiceSwaps: { scalar: ['user', 'userId'], array: ['user'] },
  ServicePreferences: { scalar: ['user', 'userId'], array: ['user'] },
  ServiceAvailability: { scalar: ['user', 'userId'], array: ['user'] },
  ServiceRatings: { scalar: [], array: [], ratings: true },
  AttendanceRecords: { scalar: ['user', 'userId'], array: ['user'] },
  AttendanceParticipants: { scalar: ['user', 'userId'], array: ['user'] },
  BvAttendance: { scalar: ['user', 'userId'], array: ['user'] },
  ChallengeEnrollments: { scalar: ['user', 'userId'], array: ['user'] },
  BvMemberRegistrations: { scalar: ['user', 'userId', 'email'], array: ['user'] },
  BvGroupMembers: { scalar: ['user', 'userId', 'memberId'], array: ['user', 'memberId'] },
  BvGroupRequests: { scalar: ['user', 'userId'], array: ['user'] },
  BvQuizSubmissions: { scalar: ['user', 'userId'], array: ['user'] },
  SadhanaEntries: { scalar: ['user', 'userId'], array: ['user'] },
  SadhanaMonthlySummaries: { scalar: ['user', 'userId'], array: ['user'] },
  SadhanaPeriodSummaries: { scalar: ['user', 'userId'], array: ['user'] },
  PushSubscriptions: { scalar: ['user', 'userId'], array: ['user'] },
  UserSkills: { scalar: ['user', 'userId'], array: ['user'] },
  OneToOneMeetings: { scalar: ['user', 'userId', 'member', 'memberId', 'guide'], array: ['user'] },
  UnavailabilityRequests: { scalar: ['user', 'userId'], array: ['user'] },
  BvslPreachingEntries: { scalar: ['user', 'userId'], array: ['user'] },
  AshrayUpgradeRequests: { scalar: ['user', 'userId'], array: ['user'] },
  JigyasaRegistrations: { scalar: ['user', 'userId', 'email'], array: ['user'] },
  JigyasaSessionAttendance: { scalar: ['user', 'userId'], array: ['user'] },
  CleanlinessInspections: { scalar: ['inspector'], array: ['inspector'] },
  GuideTransferRequests: { scalar: ['user', 'userId'], array: ['user'] },
  ResidencyTransferRequests: { scalar: ['user', 'userId'], array: ['user'] },
};

export function ownedAccountTableNames(): string[] {
  return Object.keys(OWNED_RECORD_LOOKUPS);
}

export function loadOwnedAccountTables(registry: Record<string, DeletionTable | undefined>): DeletionTable[] {
  return ownedAccountTableNames().map(name => {
    const table = registry[name];
    if (!table || typeof table.findAll !== 'function' || !table.tableName) {
      throw new Error(`Account deletion is missing the ${name} table`);
    }
    return table;
  });
}

type AccountDeletionResult = {
  success: true;
  status: 'scheduled' | 'cancelled';
  purgeAt: string | null;
  profileIds: string[];
};

type MovedRecord = { table: DeletionTable; holdId: string; record: any };

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim()))];
}

function removalFailure(alreadyPending: boolean): AppError {
  return new AppError({
    code: 'BAD_REQUEST',
    message: alreadyPending
      ? 'Account deletion is scheduled, but some records could not be removed yet. Try again.'
      : 'Some related records could not be removed. Your account was not deleted. Try again.',
  });
}

async function eachPage(table: DeletionTable, filters?: Record<string, unknown>): Promise<any[]> {
  const found: any[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let page = 0; page < 200; page += 1) {
    const result = await table.findAll({ filters, limit: 200, offset });
    const records = result.records || [];
    let added = 0;
    for (const record of records) {
      const id = record?.id ? String(record.id) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(record);
      added += 1;
    }
    if (!result.hasMore || records.length === 0 || added === 0) return found;
    offset += records.length;
  }
  throw new AppError({
    code: 'BAD_REQUEST',
    message: 'Some related records could not be removed. Your account was not deleted. Try again.',
  });
}

async function resolveProfiles(users: DeletionTable, authId: string, profileId: string, email: string): Promise<any[]> {
  const found = new Map<string, any>();
  const add = (record: any) => {
    if (record?.id) found.set(String(record.id), record);
  };
  add(await users.findOne({ id: authId }));
  if (profileId && profileId !== authId) add(await users.findOne({ id: profileId }));
  if (email) {
    for (const record of await eachPage(users, { email })) add(record);
  }
  for (const record of await eachPage(users, { firebaseUid: authId })) add(record);
  for (const userId of uniqueStrings([...found.values()].map(profile => profile.userId))) {
    for (const record of await eachPage(users, { userId })) add(record);
  }
  return [...found.values()];
}

function identityValues(profiles: any[], authId: string, email: string): string[] {
  const values = [authId, email, email.toLowerCase()];
  for (const profile of profiles) {
    for (const key of ['id', 'userId', 'uid', 'authUid', 'firebaseUid', 'email']) {
      const value = profile?.[key];
      if (typeof value === 'string' && value.trim()) {
        values.push(value.trim());
        if (key === 'email') values.push(value.trim().toLowerCase());
      }
    }
  }
  return uniqueStrings(values);
}

function referencesAccount(record: any, identities: string[], fields: string[]): boolean {
  const wanted = new Set(identities.map(value => value.toLowerCase()));
  for (const field of fields) {
    const raw = record?.[field];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null && wanted.has(String(value).toLowerCase())) return true;
    }
  }
  return false;
}

function ratingBelongs(record: any, identities: string[]): boolean {
  const hash = String(record?.raterHash || '');
  const date = String(record?.ratingDate || '');
  const service = Array.isArray(record?.service) ? record.service[0] : record?.service;
  if (!hash || !date || !service) return false;
  return identities.some(id => createHash('sha256').update(`${id}:${date}:${service}`).digest('hex') === hash);
}

async function collectOwned(table: DeletionTable, identities: string[]): Promise<any[]> {
  const spec = OWNED_RECORD_LOOKUPS[table.tableName];
  if (!spec || identities.length === 0) return [];
  const found = new Map<string, any>();
  const accept = (records: any[]) => {
    for (const record of records) {
      if (!record?.id) continue;
      const fields = [...spec.scalar, ...spec.array];
      const owned = spec.ratings
        ? ratingBelongs(record, identities)
        : referencesAccount(record, identities, fields);
      if (owned) found.set(String(record.id), record);
    }
  };
  if (spec.ratings) {
    accept(await eachPage(table));
    return [...found.values()];
  }
  for (const field of spec.scalar) {
    for (const group of chunk(identities, 30)) accept(await eachPage(table, { [field]: { in: group } }));
  }
  for (const field of spec.array) {
    for (const group of chunk(identities, 10)) accept(await eachPage(table, { [field]: { arrayContainsAny: group } }));
  }
  return [...found.values()];
}

function holdDocumentId(ownerId: string, tableName: string, recordId: string): string {
  const id = `${ownerId}__${tableName}__${recordId}`.replace(/\//g, '_');
  if (id.length > 1400) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Some related records could not be removed. Your account was not deleted. Try again.' });
  }
  return id;
}

function canonicalOwnerId(profiles: any[], authId: string): string {
  const canonical = profiles.find(profile => profile.userId && profile.status)
    || profiles.find(profile => String(profile.id) === authId)
    || profiles[0];
  return String(canonical?.id || authId);
}

async function moveRecord(holds: DeletionTable, table: DeletionTable, ownerId: string, record: any, heldAt: string): Promise<MovedRecord> {
  const holdId = holdDocumentId(ownerId, table.tableName, String(record.id));
  const existing = await holds.findOne({ id: holdId });
  if (!existing) {
    await holds.create({
      record: {
        id: holdId,
        ownerId,
        tableName: table.tableName,
        recordId: String(record.id),
        record: { ...record },
        heldAt,
      },
    });
  }
  await table.delete({ id: record.id });
  return { table, holdId, record };
}

async function restoreMoved(holds: DeletionTable, moved: MovedRecord[]): Promise<void> {
  for (const item of moved) {
    await item.table.create({ record: { ...item.record, id: item.record.id } });
    await holds.delete({ id: item.holdId });
  }
}

async function markPending(users: DeletionTable, profiles: any[], authId: string, email: string, nowMs: number, purgeAt: string): Promise<any[]> {
  const requestedAt = new Date(nowMs).toISOString();
  if (profiles.length === 0) {
    return [await users.create({
      record: {
        id: authId,
        email,
        status: PENDING_DELETION_STATUS,
        deletionRequestedAt: requestedAt,
        deletionPurgeAt: purgeAt,
        deletionPreviousStatus: null,
        deletionCreatedProfile: true,
        deletionAuthUid: authId,
      },
    })];
  }
  const updated = [];
  for (const profile of profiles) {
    const record: Record<string, unknown> = { deletionAuthUid: authId };
    if (!isPendingDeletion(profile.status)) {
      record.status = PENDING_DELETION_STATUS;
      record.deletionPreviousStatus = profile.status || 'Active';
      record.deletionRequestedAt = requestedAt;
      record.deletionPurgeAt = purgeAt;
      record.deletionCreatedProfile = false;
    }
    updated.push(await users.update({ id: profile.id, record }));
  }
  return updated;
}

export async function scheduleAccountDeletion(options: {
  authId: string;
  profileId: string;
  email: string;
  nowMs: number;
  users: DeletionTable;
  holds: DeletionTable;
  ownedTables: DeletionTable[];
}): Promise<AccountDeletionResult> {
  const email = options.email.toLowerCase();
  const profiles = await resolveProfiles(options.users, options.authId, options.profileId, email);
  const alreadyPending = profiles.some(profile => isPendingDeletion(profile.status));
  const existingPurgeAt = profiles.map(profile => profile.deletionPurgeAt).find(value => typeof value === 'string' && value);
  const purgeAt = alreadyPending && existingPurgeAt
    ? existingPurgeAt
    : new Date(options.nowMs + ACCOUNT_DELETION_GRACE_MS).toISOString();
  const ownerId = canonicalOwnerId(profiles, options.authId);
  const identities = identityValues(profiles, options.authId, email);

  let matches: { table: DeletionTable; record: any }[] = [];
  try {
    for (const table of options.ownedTables) {
      for (const record of await collectOwned(table, identities)) matches.push({ table, record });
    }
  } catch (error) {
    console.error('[accountDeletion] related record lookup failed', error);
    throw removalFailure(alreadyPending);
  }

  const moved: MovedRecord[] = [];
  try {
    for (const match of matches) {
      moved.push(await moveRecord(options.holds, match.table, ownerId, match.record, new Date(options.nowMs).toISOString()));
    }
    const saved = await markPending(options.users, profiles, options.authId, email, options.nowMs, purgeAt);
    return {
      success: true,
      status: 'scheduled',
      purgeAt,
      profileIds: saved.map(profile => String(profile.id)).filter(Boolean),
    };
  } catch (error) {
    console.error('[accountDeletion] related record removal failed', error);
    if (!alreadyPending) {
      try {
        await restoreMoved(options.holds, moved);
      } catch (restoreError) {
        console.error('[accountDeletion] could not restore records after a failed deletion', restoreError);
        throw new AppError({
          code: 'BAD_REQUEST',
          message: 'Account deletion stopped, but some records could not be restored. Sign in and contact support before trying again.',
        });
      }
    }
    throw removalFailure(alreadyPending);
  }
}

export async function cancelAccountDeletion(options: {
  authId: string;
  profileId: string;
  email: string;
  users: DeletionTable;
  holds: DeletionTable;
  ownedTables: DeletionTable[];
}): Promise<AccountDeletionResult> {
  const profiles = await resolveProfiles(options.users, options.authId, options.profileId, options.email.toLowerCase());
  if (!profiles.some(profile => isPendingDeletion(profile.status))) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'This account is not scheduled for deletion.' });
  }
  const tables = new Map(options.ownedTables.map(table => [table.tableName, table]));
  const ownerIds = uniqueStrings(profiles.map(profile => profile.id));
  const holds = [];
  for (const ownerId of ownerIds) holds.push(...await eachPage(options.holds, { ownerId }));

  for (const hold of holds) {
    const table = tables.get(String(hold.tableName || ''));
    if (!table || !hold.recordId) {
      throw new AppError({ code: 'BAD_REQUEST', message: 'This account could not be restored. Try again.' });
    }
    await table.create({ record: { ...(hold.record || {}), id: hold.recordId } });
    await options.holds.delete({ id: hold.id });
  }

  const profileIds: string[] = [];
  for (const profile of profiles) {
    if (!isPendingDeletion(profile.status)) continue;
    if (profile.deletionCreatedProfile === true && !profile.deletionPreviousStatus) {
      await options.users.delete({ id: profile.id });
      continue;
    }
    await options.users.update({
      id: profile.id,
      record: {
        status: profile.deletionPreviousStatus || 'Active',
        deletionRequestedAt: null,
        deletionPurgeAt: null,
        deletionPreviousStatus: null,
        deletionAuthUid: null,
        deletionCreatedProfile: null,
      },
    });
    profileIds.push(String(profile.id));
  }
  return { success: true, status: 'cancelled', purgeAt: null, profileIds };
}

function storageAndAuthIds(profiles: any[]): string[] {
  return uniqueStrings(profiles.flatMap(profile => [
    profile.deletionAuthUid,
    profile.firebaseUid,
    profile.uid,
    profile.authUid,
    profile.id,
  ])).filter(value => !value.includes('@') && !value.includes('/') && !/^USER-\d+$/i.test(value));
}

export async function deleteAccountImmediately(options: {
  authId: string;
  profileId: string;
  email: string;
  nowMs: number;
  users: DeletionTable;
  ownedTables: DeletionTable[];
  deleteFiles: (paths: string[], uids: string[]) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
}): Promise<{ success: true; status: 'deleted'; purgeAt: null; profileIds: string[] }> {
  const email = options.email.toLowerCase();
  const profiles = await resolveProfiles(options.users, options.authId, options.profileId, email);
  const identities = identityValues(profiles, options.authId, email);
  const owned: { table: DeletionTable; record: any }[] = [];
  for (const table of options.ownedTables) {
    for (const record of await collectOwned(table, identities)) owned.push({ table, record });
  }

  const paths = new Set<string>();
  for (const item of owned) collectStoragePaths(item.record, paths);
  for (const profile of profiles) collectStoragePaths(profile, paths);
  const authIds = storageAndAuthIds(profiles.length ? profiles : [{ id: options.authId, deletionAuthUid: options.authId }]);
  if (!authIds.includes(options.authId)) authIds.push(options.authId);

  await options.deleteFiles([...paths], authIds);
  for (const item of owned) await item.table.delete({ id: item.record.id });
  for (const uid of authIds) await options.deleteAuthUser(uid);
  for (const profile of profiles) await options.users.delete({ id: profile.id });

  return {
    success: true,
    status: 'deleted',
    purgeAt: null,
    profileIds: profiles.map(profile => String(profile.id)).filter(Boolean),
  };
}

export async function purgeDueAccountDeletions(options: {
  nowMs: number;
  users: DeletionTable;
  holds: DeletionTable;
  ownedTables: DeletionTable[];
  deleteFiles: (paths: string[], uids: string[]) => Promise<void>;
  deleteAuthUser: (uid: string) => Promise<void>;
}): Promise<{ purged: number; skipped: number }> {
  const pending = await eachPage(options.users, { status: PENDING_DELETION_STATUS });
  let purged = 0;
  let skipped = 0;
  const finished = new Set<string>();

  for (const candidate of pending) {
    if (finished.has(String(candidate.id))) continue;
    const fresh = await options.users.findOne({ id: candidate.id });
    const dueAt = Date.parse(String(fresh?.deletionPurgeAt || ''));
    if (!fresh || !isPendingDeletion(fresh.status) || !Number.isFinite(dueAt) || dueAt > options.nowMs) {
      skipped += 1;
      continue;
    }

    const authId = String(fresh.deletionAuthUid || fresh.firebaseUid || fresh.id);
    const profiles = await resolveProfiles(options.users, authId, String(fresh.id), String(fresh.email || '').toLowerCase());
    if (!profiles.some(profile => String(profile.id) === String(fresh.id))) profiles.push(fresh);
    for (const profile of profiles) finished.add(String(profile.id));

    const stillPending = await options.users.findOne({ id: fresh.id });
    if (!stillPending || !isPendingDeletion(stillPending.status)) {
      skipped += 1;
      continue;
    }

    const ownerId = canonicalOwnerId(profiles, authId);
    const identities = identityValues(profiles, authId, String(fresh.email || '').toLowerCase());
    for (const table of options.ownedTables) {
      for (const record of await collectOwned(table, identities)) {
        await moveRecord(options.holds, table, ownerId, record, new Date(options.nowMs).toISOString());
      }
    }

    const holds = [];
    for (const id of uniqueStrings([ownerId, ...profiles.map(profile => profile.id)])) {
      holds.push(...await eachPage(options.holds, { ownerId: id }));
    }
    const paths = new Set<string>();
    for (const hold of holds) collectStoragePaths(hold.record, paths);
    for (const profile of profiles) collectStoragePaths(profile, paths);
    const ids = storageAndAuthIds(profiles);

    await options.deleteFiles([...paths], ids);
    for (const uid of ids) await options.deleteAuthUser(uid);
    for (const profile of profiles) await options.users.delete({ id: profile.id });
    for (const hold of holds) await options.holds.delete({ id: hold.id });
    purged += 1;
  }

  return { purged, skipped };
}
