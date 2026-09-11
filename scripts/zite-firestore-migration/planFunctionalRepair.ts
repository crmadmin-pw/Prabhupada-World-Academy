/* eslint-disable @typescript-eslint/no-explicit-any -- migration snapshots contain heterogeneous external JSON values */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARCHIVE_COLLECTION,
  LEDGER_COLLECTION,
  PERMISSION_FIELDS,
  PRIVILEGED_ROLES,
  SOURCE_SYSTEM,
  SOURCE_TABLES,
  assertStaticConfiguration,
} from './config';
import {
  canonicalJson,
  isBlank,
  normalizeEmail,
  normalizedFieldName,
  readJson,
  readJsonLines,
  sha256,
  sourceFieldToCamelCase,
  writeCsv,
  writeJson,
  writeJsonLines,
} from './common';

interface SnapshotRow {
  id: string;
  createTime?: string;
  updateTime?: string;
  data: Record<string, any>;
}

interface SourceRow extends Record<string, any> {
  id: string;
}

interface PlannedRepairWrite {
  phase: number;
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  deleteFields?: string[];
  precondition: { exists: false } | { updateTime: string };
  reasons: string[];
  sourceRefs: string[];
  before?: Record<string, any>;
}

interface RepairDecisions {
  kind: 'functional-migration-repair-decisions';
  approvedAt: string;
  approvedBy: string;
  policy: {
    currentFirestoreIdentityAndAuthorizationWins: boolean;
    noFirebaseAuthChanges: boolean;
    noRoleOrPermissionElevation: boolean;
    preserveCurrentNonemptyNamesAndStatuses: boolean;
    evidenceFreeMissingUsers: 'archive-only';
    sadhanaBusinessKeyCollisions: 'preserve-current-archive-source';
  };
  missingUserMappings: Record<string, {
    destinationUserId: string;
    exactEmailEvidence: string;
    decision: 'approved-exact-email-link';
  }>;
  postWatermarkUsers: Record<string, {
    decision: 'create-separate-normal-folk-user';
    email: string;
    assignedUserId: string;
    createFirebaseAuth: false;
  }>;
}

const SYSTEM_SOURCE_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'source_metadata', 'autonumber_id',
]);

// These are the relationships the current application needs to locate an owner,
// parent, or scope. Reverse/back-link fields are intentionally not repaired.
const REQUIRED_LINK_FIELDS: Record<string, string[]> = {
  // Guide and Residency are optional assignments, but when present in Zite
  // they must be canonical IDs for hierarchy/profile queries.
  Users: ['Guide', 'Residency'],
  'Sadhana Entries': ['User'],
  'BV Group Members': ['User', 'Group'],
  'BV Sessions': ['Group'],
  'BV Attendance': ['Session', 'User', 'Group'],
  // Sadhana Entry is optional: facilitator-mode reports are valid without it.
  'BVSL Preaching Entries': ['User'],
  'Service Allocations': ['Service', 'User'],
  'Service Availability': ['User'],
  'Service Swaps': ['Allocation', 'From User'],
  'User Skills': ['User', 'Skill'],
  'Ashray Checklist': ['User'],
  'Residency Transfer Requests': ['User'],
  'Guide Transfer Requests': ['User', 'From Guide', 'To Guide'],
  BvQuizSubmissions: ['User', 'Quiz'],
  ServiceRatings: ['Service'],
  'Unavailability Requests': ['User', 'Service Allocation'],
  'Sadhana Monthly Summaries': ['User'],
  'One To One Meetings': ['Guide', 'Member'],
  'BVSL Weekly Plans': ['User'],
  'Jigyasa Session Attendance': ['Registration'],
  'Cleanliness Inspections': ['Room', 'Inspector', 'Residency'],
  'Cleanliness Review Requests': ['User', 'Room', 'Inspection'],
};
const OPTIONAL_WHEN_ABSENT = new Set(['Users|Guide', 'Users|Residency']);

const MANUAL_PROFILE_FIELDS = ['Full Name'];
const SAFE_DELTA_USER_FIELDS = ['Residency Approved'];

function values(value: unknown): string[] {
  if (isBlank(value)) return [];
  return (Array.isArray(value) ? value : [value]).map(item => String(item).trim()).filter(Boolean);
}

function setEquals(left: unknown, right: unknown): boolean {
  const a = [...new Set(values(left))].sort();
  const b = [...new Set(values(right))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function indexMany<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (!value) continue;
    const bucket = result.get(value) ?? [];
    bucket.push(item);
    result.set(value, bucket);
  }
  return result;
}

function fieldLookup(rows: SnapshotRow[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const key of Object.keys(row.data ?? {})) {
      const normalized = normalizedFieldName(key);
      const variants = counts.get(normalized) ?? new Map<string, number>();
      variants.set(key, (variants.get(key) ?? 0) + 1);
      counts.set(normalized, variants);
    }
  }
  return new Map([...counts].map(([normalized, variants]) => [
    normalized,
    [...variants].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
  ]));
}

function destinationField(sourceField: string, lookup: Map<string, string>): string {
  return lookup.get(normalizedFieldName(sourceField)) ?? sourceFieldToCamelCase(sourceField);
}

function overlayRows(base: SourceRow[], delta: SourceRow[]): SourceRow[] {
  const rows = new Map(base.map(row => [row.id, row]));
  for (const row of delta) rows.set(row.id, { ...(rows.get(row.id) ?? {}), ...row });
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function sourceBusinessId(table: string, row: SourceRow): string | null {
  const config = SOURCE_TABLES.find(item => item.source === table);
  for (const fields of config?.businessKeys ?? []) {
    if (fields.length !== 1) continue;
    const value = row[fields[0]];
    if (!isBlank(value) && !Array.isArray(value)) return String(value);
  }
  return null;
}

function archiveId(table: string, sourceId: string): string {
  return sha256(`${SOURCE_SYSTEM}|${table}|${sourceId}`);
}

function normalizePhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function loadZiteTables(runDir: string): Map<string, SourceRow[]> {
  const manifest = readJson<any>(path.join(runDir, 'zite/manifest.json'));
  return new Map(manifest.tables
    .filter((table: any) => table.source && table.file)
    .map((table: any) => [table.source, readJsonLines(path.join(runDir, 'zite', table.file))]));
}

function loadFirestoreTables(repairDir: string): { manifest: any; tables: Map<string, SnapshotRow[]> } {
  const manifest = readJson<any>(path.join(repairDir, 'firestore/manifest.json'));
  return {
    manifest,
    tables: new Map(manifest.tables
      .filter((table: any) => table.collection && table.file)
      .map((table: any) => [table.collection, readJsonLines(path.join(repairDir, 'firestore', table.file))])),
  };
}

function main(): void {
  assertStaticConfiguration();
  const baseRunDir = path.resolve(process.argv[2] ?? 'docs/migration-analysis/runs/20260910T174452Z/production-cutover');
  const repairDir = path.resolve(process.argv[3] ?? 'docs/migration-analysis/runs/20260910T174452Z/repair-dry-run');
  const sourceTables = loadZiteTables(baseRunDir);
  const userDelta = readJson<any>(path.join(repairDir, 'live-zite-user-delta.json'));
  const sadhanaDelta = readJson<any>(path.join(repairDir, 'live-zite-sadhana-delta-full.json'));
  const decisions = readJson<RepairDecisions>(path.join(repairDir, 'repair-decisions.json'));
  if (decisions.kind !== 'functional-migration-repair-decisions') throw new Error('Invalid repair decision artifact');
  if (!decisions.approvedAt || !decisions.approvedBy) throw new Error('Repair decisions lack approval evidence');
  if (!decisions.policy.currentFirestoreIdentityAndAuthorizationWins ||
      !decisions.policy.noFirebaseAuthChanges ||
      !decisions.policy.noRoleOrPermissionElevation ||
      !decisions.policy.preserveCurrentNonemptyNamesAndStatuses ||
      decisions.policy.evidenceFreeMissingUsers !== 'archive-only' ||
      decisions.policy.sadhanaBusinessKeyCollisions !== 'preserve-current-archive-source') {
    throw new Error('Repair decisions do not preserve the approved identity, authorization, and archive policy');
  }
  sourceTables.set('Users', overlayRows(sourceTables.get('Users') ?? [], userDelta.rows ?? []));
  sourceTables.set('Sadhana Entries', overlayRows(sourceTables.get('Sadhana Entries') ?? [], sadhanaDelta.rows ?? []));

  const baseUsers = new Map((loadZiteTables(baseRunDir).get('Users') ?? []).map(row => [row.id, row]));
  const schemas = new Map(readJsonLines(path.join(baseRunDir, 'zite/schema.jsonl')).map(row => [row.name, row]));
  const current = loadFirestoreTables(repairDir);
  const rowsByCollectionAndId = new Map<string, SnapshotRow>();
  for (const [collection, rows] of current.tables) {
    for (const row of rows) rowsByCollectionAndId.set(`${collection}|${row.id}`, row);
  }
  const lookupByCollection = new Map([...current.tables].map(([collection, rows]) => [collection, fieldLookup(rows)]));
  const currentUsers = current.tables.get('Users') ?? [];
  const currentGuides = current.tables.get('Guides') ?? [];
  const usersByEmail = indexMany(currentUsers, row => normalizeEmail(row.data.email));
  const usersByUserId = indexMany(currentUsers, row => String(row.data.userId ?? '').trim().toLowerCase());
  const guidesByEmail = indexMany(currentGuides, row => normalizeEmail(row.data.email));
  const currentUsersByPhone = indexMany(currentUsers, row => normalizePhone(row.data.phone));
  const authSnapshotPath = path.join(repairDir, 'firebase-auth.json');
  if (!fs.existsSync(authSnapshotPath)) throw new Error(`Missing fresh Firebase Auth snapshot: ${authSnapshotPath}`);
  const authSnapshot = readJson<any>(authSnapshotPath);
  if (authSnapshot.projectId !== 'bvpw108' || authSnapshot.readOnly !== true) throw new Error('Invalid Firebase Auth snapshot');
  const authUsers = authSnapshot.users ?? [];
  const authByEmail = indexMany(authUsers, (row: any) => normalizeEmail(row.email));

  const existingLedgers = (current.tables.get(LEDGER_COLLECTION) ?? []).map(row => row.data);
  const mapping = new Map<string, { collection: string; documentId: string; rule: string }>();
  for (const ledger of existingLedgers) {
    if (!ledger.sourceTable || !ledger.destinationDocumentId || !ledger.destinationCollection) continue;
    if (['archive', 'limitation', 'review'].includes(ledger.action)) continue;
    mapping.set(`${ledger.sourceTable}|${ledger.sourceRecordId}`, {
      collection: ledger.destinationCollection,
      documentId: ledger.destinationDocumentId,
      rule: `existing-ledger:${ledger.matchRule}`,
    });
  }

  const identityReviews: Record<string, unknown>[] = [];
  const acceptedLimitations: Record<string, unknown>[] = [];
  for (const sourceUser of sourceTables.get('Users') ?? []) {
    const email = normalizeEmail(sourceUser.Email);
    if (!email) continue;
    const matches = usersByEmail.get(email) ?? [];
    if (matches.length === 1) {
      mapping.set(`Users|${sourceUser.id}`, { collection: 'Users', documentId: matches[0].id, rule: 'exact-normalized-email' });
    } else if (matches.length === 0 && !baseUsers.has(sourceUser.id)) {
      const sourceUserId = String(sourceUser['User ID'] ?? '').trim().toLowerCase();
      const userIdMatches = sourceUserId ? usersByUserId.get(sourceUserId) ?? [] : [];
      if (userIdMatches.length > 0) {
        const decision = decisions.postWatermarkUsers[sourceUser.id];
        if (!decision || decision.decision !== 'create-separate-normal-folk-user' ||
            normalizeEmail(decision.email) !== email || decision.createFirebaseAuth !== false ||
            !decision.assignedUserId) {
          identityReviews.push({
            kind: 'new-user-business-id-collision', sourceTable: 'Users', sourceRecordId: sourceUser.id,
            email, name: sourceUser['Full Name'] ?? '',
            evidence: `Zite User ID ${sourceUser['User ID']} is already used by ${userIdMatches.map(row => normalizeEmail(row.data.email)).join(', ')}`,
            candidateCurrentUserIds: userIdMatches.map(row => row.id),
          });
        } else if ((usersByUserId.get(decision.assignedUserId.trim().toLowerCase()) ?? []).length > 0) {
          throw new Error(`Approved replacement User ID is no longer unique: ${decision.assignedUserId}`);
        } else {
          mapping.set(`Users|${sourceUser.id}`, {
            collection: 'Users', documentId: sourceUser.id, rule: 'approved-new-delta-email-with-reassigned-user-id',
          });
        }
      } else {
        mapping.set(`Users|${sourceUser.id}`, { collection: 'Users', documentId: sourceUser.id, rule: 'new-delta-exact-email-unmatched' });
      }
    } else {
      identityReviews.push({
        kind: matches.length > 1 ? 'duplicate-current-email' : 'source-user-unmapped',
        sourceTable: 'Users', sourceRecordId: sourceUser.id, email, name: sourceUser['Full Name'] ?? '',
        evidence: `${matches.length} current exact-email matches`, candidateCurrentUserIds: matches.map(row => row.id),
      });
    }
  }

  const sourceGuides = sourceTables.get('Guides') ?? [];
  for (const sourceGuide of sourceGuides) {
    const email = normalizeEmail(sourceGuide.Email);
    const matches = email ? guidesByEmail.get(email) ?? [] : [];
    if (matches.length === 1) {
      mapping.set(`Guides|${sourceGuide.id}`, { collection: 'Guides', documentId: matches[0].id, rule: 'corrected-exact-normalized-email' });
    } else if (email && matches.length === 0) {
      mapping.set(`Guides|${sourceGuide.id}`, { collection: 'Guides', documentId: sourceGuide.id, rule: 'corrected-create-inactive-exact-email' });
    } else {
      identityReviews.push({
        kind: matches.length > 1 ? 'duplicate-current-guide-email' : 'guide-email-missing',
        sourceTable: 'Guides', sourceRecordId: sourceGuide.id, email, name: sourceGuide['Full Name'] ?? '',
        evidence: `${matches.length} current exact-email matches`, candidateCurrentUserIds: matches.map(row => row.id),
      });
    }
  }

  // Explicit operator-approved recovery for a deleted source User row. The
  // approved destination document must still carry the exact evidence email.
  for (const [missingSourceUserId, decision] of Object.entries(decisions.missingUserMappings)) {
    if (decision.decision !== 'approved-exact-email-link') throw new Error(`Unsupported missing-user decision: ${missingSourceUserId}`);
    const target = rowsByCollectionAndId.get(`Users|${decision.destinationUserId}`);
    if (!target) throw new Error(`Approved missing-user target is absent: ${decision.destinationUserId}`);
    if (normalizeEmail(target.data.email) !== normalizeEmail(decision.exactEmailEvidence)) {
      throw new Error(`Approved missing-user email evidence drifted: ${missingSourceUserId}`);
    }
    mapping.set(`Users|${missingSourceUserId}`, {
      collection: 'Users', documentId: decision.destinationUserId, rule: 'operator-approved-deleted-user-exact-email-evidence',
    });
  }

  const deltaSourceRefs = new Set<string>();
  for (const row of userDelta.rows ?? []) if (!baseUsers.has(row.id)) deltaSourceRefs.add(`Users|${row.id}`);
  for (const sourceUserId of Object.keys(decisions.postWatermarkUsers)) {
    const target = mapping.get(`Users|${sourceUserId}`);
    if (target && !rowsByCollectionAndId.has(`Users|${target.documentId}`)) deltaSourceRefs.add(`Users|${sourceUserId}`);
  }
  const baseSadhanaIds = new Set((loadZiteTables(baseRunDir).get('Sadhana Entries') ?? []).map(row => row.id));
  for (const row of sadhanaDelta.rows ?? []) {
    if (baseSadhanaIds.has(row.id)) continue;
    mapping.set(`Sadhana Entries|${row.id}`, { collection: 'SadhanaEntries', documentId: row.id, rule: 'new-delta-source-system-id' });
    deltaSourceRefs.add(`Sadhana Entries|${row.id}`);
  }

  const repairRunId = `repair_${sha256(canonicalJson({
    sourceWatermark: userDelta.sourceWatermark,
    userDeltaCapturedAt: userDelta.capturedAt,
    sadhanaDeltaCapturedAt: sadhanaDelta.capturedAt,
    firestoreSnapshot: current.manifest.checksum,
  })).slice(0, 20)}`;

  const writes = new Map<string, PlannedRepairWrite>();
  function addUpdate(
    collection: string,
    documentId: string,
    field: string,
    value: any,
    reason: string,
    sourceRef: string,
  ): void {
    const currentRow = rowsByCollectionAndId.get(`${collection}|${documentId}`);
    if (!currentRow?.updateTime) throw new Error(`Missing current row/updateTime for ${collection}/${documentId}`);
    const key = `update|${collection}|${documentId}`;
    const write = writes.get(key) ?? {
      phase: 2, operation: 'update', collection, documentId, data: {},
      precondition: { updateTime: currentRow.updateTime }, reasons: [], sourceRefs: [], before: {},
    } satisfies PlannedRepairWrite;
    write.data[field] = value;
    write.before![field] = currentRow.data[field];
    if (!write.reasons.includes(reason)) write.reasons.push(reason);
    if (!write.sourceRefs.includes(sourceRef)) write.sourceRefs.push(sourceRef);
    writes.set(key, write);
  }

  function addDeleteFields(collection: string, documentId: string, fields: string[], reason: string, sourceRef: string): void {
    const currentRow = rowsByCollectionAndId.get(`${collection}|${documentId}`);
    if (!currentRow?.updateTime) throw new Error(`Missing current row/updateTime for ${collection}/${documentId}`);
    const key = `update|${collection}|${documentId}`;
    const write = writes.get(key) ?? {
      phase: 1, operation: 'update', collection, documentId, data: {},
      precondition: { updateTime: currentRow.updateTime }, reasons: [], sourceRefs: [], before: {},
    } satisfies PlannedRepairWrite;
    write.phase = Math.min(write.phase, 1);
    write.deleteFields = [...new Set([...(write.deleteFields ?? []), ...fields])].sort();
    for (const field of fields) write.before![field] = currentRow.data[field];
    if (!write.reasons.includes(reason)) write.reasons.push(reason);
    if (!write.sourceRefs.includes(sourceRef)) write.sourceRefs.push(sourceRef);
    writes.set(key, write);
  }

  function addCreate(collection: string, documentId: string, data: Record<string, any>, reason: string, sourceRef: string, phase = 1): void {
    const key = `create|${collection}|${documentId}`;
    if (rowsByCollectionAndId.has(`${collection}|${documentId}`)) throw new Error(`Create target already exists: ${collection}/${documentId}`);
    if (writes.has(key)) return;
    writes.set(key, {
      phase, operation: 'create', collection, documentId, data,
      precondition: { exists: false }, reasons: [reason], sourceRefs: [sourceRef],
    });
  }

  function mappedTarget(targetTable: string, raw: unknown): { expected: string[]; unresolved: string[] } {
    const expected: string[] = [];
    const unresolved: string[] = [];
    for (const sourceId of values(raw)) {
      const target = mapping.get(`${targetTable}|${sourceId}`);
      if (target?.documentId) expected.push(target.documentId);
      else unresolved.push(sourceId);
    }
    return { expected, unresolved };
  }

  function transformSourceRow(table: string, row: SourceRow, collection: string, documentId: string): Record<string, any> {
    const schema = schemas.get(table);
    const fields = new Map((schema?.fields ?? []).map((field: any) => [field.name, field]));
    const lookup = lookupByCollection.get(collection) ?? new Map<string, string>();
    const data: Record<string, any> = {};
    for (const [sourceField, raw] of Object.entries(row)) {
      if (SYSTEM_SOURCE_FIELDS.has(sourceField) || isBlank(raw) || (Array.isArray(raw) && raw.length === 0)) continue;
      const field: any = fields.get(sourceField);
      const targetField = destinationField(sourceField, lookup);
      if (field?.type === 'linked_record') {
        const target = mappedTarget(field.linksTo, raw);
        if (target.unresolved.length > 0) continue;
        data[targetField] = target.expected.length === 1 ? target.expected[0] : target.expected;
      } else {
        data[targetField] = raw;
      }
    }
    data.id = documentId;
    data.migrationRepairProvenance = {
      repairRunId, sourceSystem: SOURCE_SYSTEM, sourceTable: table, sourceRecordId: row.id,
      sourceChecksum: sha256(canonicalJson(row)),
    };
    return data;
  }

  // Existing migrated users belong to the FOLK source. Only fill a missing
  // segment; never overwrite a current segment, role, status, Auth alias, or permission flag.
  for (const sourceUser of sourceTables.get('Users') ?? []) {
    const target = mapping.get(`Users|${sourceUser.id}`);
    if (!target) continue;
    const currentUser = rowsByCollectionAndId.get(`Users|${target.documentId}`);
    if (currentUser && isBlank(currentUser.data.segment)) {
      addUpdate('Users', currentUser.id, 'segment', 'FOLK', 'fill-missing-folk-segment', `Users|${sourceUser.id}`);
    }
  }

  // Separate the Guide that was incorrectly merged by Guide ID. The current
  // role policy remains authoritative: the historical Guide is created inactive.
  for (const sourceGuide of sourceGuides) {
    const target = mapping.get(`Guides|${sourceGuide.id}`);
    if (!target || rowsByCollectionAndId.has(`Guides|${target.documentId}`)) continue;
    const data = transformSourceRow('Guides', sourceGuide, 'Guides', target.documentId);
    if (data.guideId) {
      data.legacyGuideId = data.guideId;
      delete data.guideId;
    }
    data.segment = 'FOLK';
    data.isActive = false;
    addCreate('Guides', target.documentId, data, 'restore-separate-guide-identity-inactive', `Guides|${sourceGuide.id}`, 1);
  }

  const vdndGuide = (guidesByEmail.get('vdnd@hkmmumbai.org') ?? [])[0];
  if (vdndGuide?.data.migrationProvenance?.sourceRecordId === 'df4623bc-ee50-40f2-bc96-aa5c307c2ee1') {
    addDeleteFields(
      'Guides', vdndGuide.id, ['abbreviation', 'phone', 'id', 'migrationProvenance'],
      'remove-fields-contaminated-by-wrong-guide-merge', 'Guides|df4623bc-ee50-40f2-bc96-aa5c307c2ee1',
    );
  }

  // Access restoration is a separate authorization decision. Record every
  // historical Guide that lacks the exact Auth + current role + active Guide
  // combination, but never propose creating Auth users or elevating roles.
  for (const sourceGuide of sourceGuides) {
    const email = normalizeEmail(sourceGuide.Email);
    const userMatches = usersByEmail.get(email) ?? [];
    const guideTarget = mapping.get(`Guides|${sourceGuide.id}`);
    const currentGuide = guideTarget
      ? rowsByCollectionAndId.get(`Guides|${guideTarget.documentId}`)
      : undefined;
    const role = String(userMatches[0]?.data.role ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    const hasGuideCapability = userMatches.length === 1 && (
      ['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN', 'ADMIN'].includes(role) ||
      userMatches[0].data.isSadhanaMentor === true
    );
    const accessReady = authByEmail.get(email)?.length === 1 && hasGuideCapability && currentGuide?.data.isActive === true;
    if (!accessReady) {
      acceptedLimitations.push({
        kind: 'guide-access-policy-decision', sourceTable: 'Guides', sourceRecordId: sourceGuide.id,
        email, name: sourceGuide['Full Name'] ?? '',
        evidence: `auth=${authByEmail.get(email)?.length ?? 0}; currentRole=${userMatches[0]?.data.role ?? ''}; guideActive=${currentGuide?.data.isActive ?? false}`,
        disposition: 'retain-current-role-and-auth-state',
        candidateCurrentUserIds: userMatches.map(row => row.id),
      });
    }
  }

  // Create the post-watermark User conservatively as an ordinary pending FOLK
  // user. This creates no Firebase Auth account and grants no permissions.
  for (const sourceUser of sourceTables.get('Users') ?? []) {
    const sourceRef = `Users|${sourceUser.id}`;
    if (!deltaSourceRefs.has(sourceRef)) continue;
    const target = mapping.get(sourceRef);
    if (!target || rowsByCollectionAndId.has(`Users|${target.documentId}`)) continue;
    const data = transformSourceRow('Users', sourceUser, 'Users', target.documentId);
    const decision = decisions.postWatermarkUsers[sourceUser.id];
    if (decision) {
      data.legacyUserId = sourceUser['User ID'] ?? null;
      data.userId = decision.assignedUserId;
    }
    data.role = 'User';
    data.segment = 'FOLK';
    for (const flag of PERMISSION_FIELDS) data[flag] = false;
    addCreate('Users', target.documentId, data, 'post-watermark-user-catch-up-no-auth', sourceRef, 1);
  }

  // A source-created user changed after cutover. Only a non-permission profile
  // approval flag is safe to propose automatically; source status remains a review.
  for (const deltaUser of userDelta.rows ?? []) {
    const baseUser = baseUsers.get(deltaUser.id);
    const target = mapping.get(`Users|${deltaUser.id}`);
    const currentUser = target ? rowsByCollectionAndId.get(`Users|${target.documentId}`) : undefined;
    if (!baseUser || !currentUser) continue;
    for (const sourceField of SAFE_DELTA_USER_FIELDS) {
      if (canonicalJson(baseUser[sourceField]) === canonicalJson(deltaUser[sourceField])) continue;
      const lookup = lookupByCollection.get('Users') ?? new Map<string, string>();
      const currentField = destinationField(sourceField, lookup);
      if (canonicalJson(currentUser.data[currentField]) === canonicalJson(baseUser[sourceField])) {
        addUpdate('Users', currentUser.id, currentField, deltaUser[sourceField], 'post-watermark-source-profile-catch-up', `Users|${deltaUser.id}`);
      }
    }
    if (canonicalJson(baseUser.Status) !== canonicalJson(deltaUser.Status)) {
      acceptedLimitations.push({
        kind: 'post-watermark-status-change', sourceTable: 'Users', sourceRecordId: deltaUser.id,
        email: normalizeEmail(deltaUser.Email), name: deltaUser['Full Name'] ?? '',
        evidence: `${baseUser.Status ?? ''} -> ${deltaUser.Status ?? ''}; current status policy requires approval`,
        disposition: 'retain-current-firestore-status',
        candidateCurrentUserIds: [currentUser.id],
      });
    }
  }

  // Restore previously archive-only Sadhana rows only when the operator has
  // approved the formerly missing owner by exact email evidence. Keep the
  // original immutable limitation ledger and append a separate repair ledger.
  const currentSadhana = current.tables.get('SadhanaEntries') ?? [];
  for (const sourceRow of sourceTables.get('Sadhana Entries') ?? []) {
    const sourceRef = `Sadhana Entries|${sourceRow.id}`;
    if (mapping.has(sourceRef) || deltaSourceRefs.has(sourceRef)) continue;
    const ownerIds = values(sourceRow.User);
    if (ownerIds.length !== 1 || !decisions.missingUserMappings[ownerIds[0]]) continue;
    const owner = mappedTarget('Users', sourceRow.User);
    if (owner.unresolved.length > 0 || owner.expected.length !== 1) continue;
    const date = String(sourceRow['Entry Date'] ?? '').slice(0, 10);
    const collisions = currentSadhana.filter(row =>
      values(row.data.user).includes(owner.expected[0]) && String(row.data.entryDate ?? '').slice(0, 10) === date,
    );
    if (collisions.length > 0) {
      if (decisions.policy.sadhanaBusinessKeyCollisions !== 'preserve-current-archive-source') {
        identityReviews.push({
          kind: 'approved-owner-sadhana-business-key-collision', sourceTable: 'Sadhana Entries',
          sourceRecordId: sourceRow.id, email: '', name: '', evidence: `${owner.expected[0]}|${date}`,
          candidateCurrentUserIds: collisions.map(row => row.id),
        });
        continue;
      }
      acceptedLimitations.push({
        kind: 'approved-owner-sadhana-business-key-collision', sourceTable: 'Sadhana Entries',
        sourceRecordId: sourceRow.id, email: '', name: '', evidence: `${owner.expected[0]}|${date}`,
        candidateCurrentUserIds: collisions.map(row => row.id),
        disposition: 'preserve-current-archive-source',
      });
      mapping.set(sourceRef, {
        collection: 'SadhanaEntries', documentId: collisions[0].id,
        rule: 'preserve-current-business-key-collision-archive-source',
      });
      continue;
    }
    mapping.set(sourceRef, {
      collection: 'SadhanaEntries', documentId: sourceRow.id, rule: 'operator-approved-owner-recovery',
    });
    addCreate(
      'SadhanaEntries', sourceRow.id,
      transformSourceRow('Sadhana Entries', sourceRow, 'SadhanaEntries', sourceRow.id),
      'restore-approved-owner-sadhana', sourceRef, 3,
    );
    const repairLedgerId = sha256(`${repairRunId}|recovered-operational|${sourceRef}`);
    addCreate(LEDGER_COLLECTION, repairLedgerId, {
      sourceSystem: SOURCE_SYSTEM,
      sourceTable: 'Sadhana Entries',
      sourceRecordId: sourceRow.id,
      sourceBusinessId: sourceBusinessId('Sadhana Entries', sourceRow),
      destinationCollection: 'SadhanaEntries',
      destinationDocumentId: sourceRow.id,
      matchRule: 'operator-approved-owner-recovery',
      action: 'repair-create',
      sourceChecksum: sha256(canonicalJson(sourceRow)),
      runId: repairRunId,
      supersedesLimitationLedger: archiveId('Sadhana Entries', sourceRow.id),
    }, 'ledger-approved-owner-sadhana-recovery', sourceRef, 4);
  }

  const unresolvedRelationships: Record<string, unknown>[] = [];
  const sourceSessions = new Map((sourceTables.get('BV Sessions') ?? []).map(row => [row.id, row]));
  for (const [table, requiredFields] of Object.entries(REQUIRED_LINK_FIELDS)) {
    const config = SOURCE_TABLES.find(item => item.source === table);
    if (!config?.destination) continue;
    const schema = schemas.get(table);
    const schemaFields = new Map((schema?.fields ?? []).map((field: any) => [field.name, field]));
    const lookup = lookupByCollection.get(config.destination) ?? new Map<string, string>();
    for (const sourceRow of sourceTables.get(table) ?? []) {
      const sourceRef = `${table}|${sourceRow.id}`;
      const recordTarget = mapping.get(sourceRef);
      const currentRow = recordTarget
        ? rowsByCollectionAndId.get(`${config.destination}|${recordTarget.documentId}`)
        : undefined;
      const isPlannedCreate = !!recordTarget && (
        writes.has(`create|${config.destination}|${recordTarget.documentId}`) ||
        (table === 'Sadhana Entries' && deltaSourceRefs.has(sourceRef))
      );
      if (!recordTarget || (!currentRow && !isPlannedCreate)) {
        for (const sourceField of requiredFields) {
          let raw = sourceRow[sourceField];
          if (table === 'BV Attendance' && sourceField === 'Group' && values(raw).length === 0) {
            const session = sourceSessions.get(values(sourceRow.Session)[0]);
            raw = session?.Group;
          }
          if (values(raw).length === 0 && OPTIONAL_WHEN_ABSENT.has(`${table}|${sourceField}`)) continue;
          const field: any = schemaFields.get(sourceField);
          const target = field?.linksTo ? mappedTarget(field.linksTo, raw) : { expected: [], unresolved: values(raw) };
          unresolvedRelationships.push({
            sourceTable: table, sourceRecordId: sourceRow.id, sourceField,
            targetTable: field?.linksTo ?? '',
            sourceTargetIds: values(raw), unresolvedTargetIds: target.unresolved,
            reason: !recordTarget ? 'source-record-not-operational' : 'destination-record-missing',
          });
        }
        continue;
      }
      if (!currentRow) continue; // Newly created rows already contain transformed links.
      for (const sourceField of requiredFields) {
        let raw = sourceRow[sourceField];
        if (table === 'BV Attendance' && sourceField === 'Group' && values(raw).length === 0) {
          const session = sourceSessions.get(values(sourceRow.Session)[0]);
          raw = session?.Group;
        }
        if (values(raw).length === 0) {
          if (OPTIONAL_WHEN_ABSENT.has(`${table}|${sourceField}`)) continue;
          unresolvedRelationships.push({
            sourceTable: table, sourceRecordId: sourceRow.id, sourceField,
            targetTable: (schemaFields.get(sourceField) as any)?.linksTo ?? '',
            sourceTargetIds: [], unresolvedTargetIds: [], reason: 'required-source-link-missing',
          });
          continue;
        }
        const field: any = schemaFields.get(sourceField);
        if (!field?.linksTo) throw new Error(`Required relationship lacks schema target: ${table}.${sourceField}`);
        const target = mappedTarget(field.linksTo, raw);
        if (target.unresolved.length > 0) {
          unresolvedRelationships.push({
            sourceTable: table, sourceRecordId: sourceRow.id, sourceField,
            targetTable: field.linksTo,
            sourceTargetIds: values(raw), unresolvedTargetIds: target.unresolved, reason: 'target-identity-unresolved',
          });
          continue;
        }
        const currentField = destinationField(sourceField, lookup);
        const expected: any = target.expected.length === 1 ? target.expected[0] : target.expected;
        if (!setEquals(currentRow.data[currentField], expected)) {
          addUpdate(config.destination, currentRow.id, currentField, expected, 'canonicalize-application-relationship', sourceRef);
        }
      }
    }
  }

  // Create post-watermark Sadhana rows only after exact owner mapping and a
  // same-owner/same-day collision check.
  for (const sourceRow of sadhanaDelta.rows ?? []) {
    if (baseSadhanaIds.has(sourceRow.id)) continue;
    const sourceRef = `Sadhana Entries|${sourceRow.id}`;
    const owner = mappedTarget('Users', sourceRow.User);
    if (owner.unresolved.length > 0 || owner.expected.length !== 1) {
      unresolvedRelationships.push({
        sourceTable: 'Sadhana Entries', sourceRecordId: sourceRow.id, sourceField: 'User',
        targetTable: 'Users',
        sourceTargetIds: values(sourceRow.User), unresolvedTargetIds: owner.unresolved,
        reason: 'post-watermark-owner-unresolved',
      });
      continue;
    }
    const date = String(sourceRow['Entry Date'] ?? '').slice(0, 10);
    const collisions = currentSadhana.filter(row =>
      values(row.data.user).includes(owner.expected[0]) && String(row.data.entryDate ?? '').slice(0, 10) === date,
    );
    if (collisions.length > 0) {
      identityReviews.push({
        kind: 'post-watermark-sadhana-business-key-collision', sourceTable: 'Sadhana Entries',
        sourceRecordId: sourceRow.id, email: '', name: '', evidence: `${owner.expected[0]}|${date}`,
        candidateCurrentUserIds: collisions.map(row => row.id),
      });
      continue;
    }
    const data = transformSourceRow('Sadhana Entries', sourceRow, 'SadhanaEntries', sourceRow.id);
    addCreate('SadhanaEntries', sourceRow.id, data, 'post-watermark-sadhana-catch-up', sourceRef, 3);
  }

  // Archive and ledger only truly new source rows. Existing limitation rows
  // already have immutable archive/ledger evidence from the original run.
  const currentArchiveIds = new Set((current.tables.get(ARCHIVE_COLLECTION) ?? []).map(row => row.id));
  const currentLedgerIds = new Set((current.tables.get(LEDGER_COLLECTION) ?? []).map(row => row.id));
  for (const sourceRef of deltaSourceRefs) {
    const split = sourceRef.indexOf('|');
    const table = sourceRef.slice(0, split);
    const sourceId = sourceRef.slice(split + 1);
    const sourceRow = (sourceTables.get(table) ?? []).find(row => row.id === sourceId);
    const target = mapping.get(sourceRef);
    if (!sourceRow || !target) continue;
    const evidenceId = archiveId(table, sourceId);
    const sourceChecksum = sha256(canonicalJson(sourceRow));
    if (!currentArchiveIds.has(evidenceId)) {
      addCreate(ARCHIVE_COLLECTION, evidenceId, {
        sourceSystem: SOURCE_SYSTEM, sourceTable: table, sourceRecordId: sourceId,
        sourceCreatedAt: sourceRow.created_at ?? null, sourceUpdatedAt: sourceRow.updated_at ?? null,
        sourceChecksum, runId: repairRunId, operationallyRestored: false, sourceData: sourceRow,
      }, 'archive-post-watermark-source-row', sourceRef, 4);
    }
    if (!currentLedgerIds.has(evidenceId)) {
      addCreate(LEDGER_COLLECTION, evidenceId, {
        sourceSystem: SOURCE_SYSTEM, sourceTable: table, sourceRecordId: sourceId,
        sourceBusinessId: sourceBusinessId(table, sourceRow),
        destinationCollection: target.collection, destinationDocumentId: target.documentId,
        matchRule: target.rule, action: 'create', sourceChecksum, runId: repairRunId,
      }, 'ledger-post-watermark-source-row', sourceRef, 4);
    }
  }

  // Preserve current spellings until the operator resolves the four genuine
  // name disagreements. Relationship names are handled separately as IDs.
  for (const sourceUser of sourceTables.get('Users') ?? []) {
    const target = mapping.get(`Users|${sourceUser.id}`);
    const currentUser = target ? rowsByCollectionAndId.get(`Users|${target.documentId}`) : undefined;
    if (!currentUser) continue;
    const lookup = lookupByCollection.get('Users') ?? new Map<string, string>();
    for (const sourceField of MANUAL_PROFILE_FIELDS) {
      const currentField = destinationField(sourceField, lookup);
      const sourceValue = sourceUser[sourceField];
      const currentValue = currentUser.data[currentField];
      if (isBlank(sourceValue) || isBlank(currentValue)) continue;
      if (String(sourceValue).trim().toLowerCase() === String(currentValue).trim().toLowerCase()) continue;
      acceptedLimitations.push({
        kind: 'profile-value-conflict', sourceTable: 'Users', sourceRecordId: sourceUser.id,
        email: normalizeEmail(sourceUser.Email), name: sourceUser['Full Name'] ?? '',
        evidence: `${currentField}: current=${currentValue}; zite=${sourceValue}`,
        disposition: 'retain-current-nonempty-profile-value',
        candidateCurrentUserIds: [currentUser.id],
      });
    }
  }

  // Consolidate missing/deleted source User IDs into an operator-friendly map.
  const sourceUserIds = new Set((sourceTables.get('Users') ?? []).map(row => row.id));
  const sourceTagMango = sourceTables.get('TagMango Sync Log') ?? [];
  const missingUserRefs = new Map<string, { tables: Map<string, number>; sadhana: number }>();
  for (const row of unresolvedRelationships) {
    const sourceTable = String(row.sourceTable ?? '');
    if (row.targetTable !== 'Users') continue;
    const unresolved = (row.unresolvedTargetIds as string[] | undefined) ?? [];
    for (const id of unresolved) {
      if (sourceUserIds.has(id)) continue;
      const bucket = missingUserRefs.get(id) ?? { tables: new Map<string, number>(), sadhana: 0 };
      bucket.tables.set(sourceTable, (bucket.tables.get(sourceTable) ?? 0) + 1);
      if (sourceTable === 'Sadhana Entries') bucket.sadhana += 1;
      missingUserRefs.set(id, bucket);
    }
  }
  const missingIdentityRows = [...missingUserRefs].map(([sourceUserId, counts]) => {
    const evidence = sourceTagMango.filter(row => values(row['Matched User']).includes(sourceUserId));
    const evidenceEmails = [...new Set(evidence.map(row => normalizeEmail(row.Email)).filter(Boolean))];
    const evidencePhones = [...new Set(evidence.map(row => normalizePhone(row.Phone)).filter(Boolean))];
    const candidates = new Set<string>();
    for (const email of evidenceEmails) for (const row of usersByEmail.get(email) ?? []) candidates.add(row.id);
    for (const phone of evidencePhones) for (const row of currentUsersByPhone.get(phone) ?? []) candidates.add(row.id);
    return {
      missingZiteUserId: sourceUserId,
      sadhanaRows: counts.sadhana,
      affectedTables: [...counts.tables].map(([table, count]) => `${table}:${count}`).join(' | '),
      historicalEvidenceEmails: evidenceEmails,
      historicalEvidencePhones: evidencePhones,
      candidateCurrentUserIds: [...candidates],
      decision: '',
      warning: candidates.size ? 'candidate-only; exact Gmail approval required' : 'no recoverable identity evidence',
    };
  }).sort((a, b) => b.sadhanaRows - a.sadhanaRows || a.missingZiteUserId.localeCompare(b.missingZiteUserId));
  for (const row of missingIdentityRows) {
    acceptedLimitations.push({
      kind: 'missing-historical-user-without-approved-evidence',
      sourceTable: 'Users',
      sourceRecordId: row.missingZiteUserId,
      email: '',
      name: '',
      evidence: row.affectedTables,
      disposition: 'archive-only-no-operational-owner',
      candidateCurrentUserIds: row.candidateCurrentUserIds,
    });
  }

  const orderedWrites = [...writes.values()].sort((a, b) =>
    a.phase - b.phase || a.collection.localeCompare(b.collection) || a.documentId.localeCompare(b.documentId));
  const validationErrors: string[] = [];
  const simulated = new Map<string, Record<string, any>>();
  for (const [collection, rows] of current.tables) {
    for (const row of rows) simulated.set(`${collection}|${row.id}`, structuredClone(row.data));
  }
  const protectedExistingUserFields = new Set(['role', 'status', 'uid', 'authUid', 'firebaseUid', 'firebaseAuthUid', ...PERMISSION_FIELDS]);
  for (const write of orderedWrites) {
    const key = `${write.collection}|${write.documentId}`;
    const captured = rowsByCollectionAndId.get(key);
    if (/^LLP/i.test(write.collection) || write.collection === 'PushSubscriptions') {
      validationErrors.push(`Forbidden collection write: ${key}`);
    }
    if (write.operation === 'create') {
      if (captured) validationErrors.push(`Create target exists in snapshot: ${key}`);
      if (!('exists' in write.precondition) || write.precondition.exists !== false) {
        validationErrors.push(`Create lacks exists:false precondition: ${key}`);
      }
      simulated.set(key, structuredClone(write.data));
      continue;
    }
    if (!captured?.updateTime || !('updateTime' in write.precondition) || write.precondition.updateTime !== captured.updateTime) {
      validationErrors.push(`Update-time precondition mismatch: ${key}`);
    }
    if (write.collection === 'Users') {
      for (const field of Object.keys(write.data)) {
        if (protectedExistingUserFields.has(field)) validationErrors.push(`Protected existing User field update: ${key}.${field}`);
      }
      for (const field of write.deleteFields ?? []) {
        if (protectedExistingUserFields.has(field)) validationErrors.push(`Protected existing User field deletion: ${key}.${field}`);
      }
    }
    const data = structuredClone(simulated.get(key) ?? {});
    Object.assign(data, write.data);
    for (const field of write.deleteFields ?? []) delete data[field];
    simulated.set(key, data);
  }

  function duplicateValues(collection: string, field: string, normalize: (value: unknown) => string): string[] {
    const counts = new Map<string, number>();
    for (const [key, data] of simulated) {
      if (!key.startsWith(`${collection}|`)) continue;
      const value = normalize(data[field]);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
  }
  for (const email of duplicateValues('Users', 'email', normalizeEmail)) validationErrors.push(`Duplicate simulated Users.email: ${email}`);
  for (const id of duplicateValues('Users', 'userId', value => String(value ?? '').trim().toLowerCase())) validationErrors.push(`Duplicate simulated Users.userId: ${id}`);
  for (const email of duplicateValues('Guides', 'email', normalizeEmail)) validationErrors.push(`Duplicate simulated Guides.email: ${email}`);
  for (const id of duplicateValues('Guides', 'guideId', value => String(value ?? '').trim().toLowerCase())) validationErrors.push(`Duplicate simulated Guides.guideId: ${id}`);

  function roleManifest(getData: (row: SnapshotRow) => Record<string, any>): string {
    const rows = currentUsers
      .map(row => ({ id: row.id, data: getData(row) }))
      .filter(row => PRIVILEGED_ROLES.has(String(row.data.role ?? '').trim().toLowerCase()) || PERMISSION_FIELDS.some(field => row.data[field] === true))
      .map(row => ({
        id: row.id, email: normalizeEmail(row.data.email), role: row.data.role ?? null,
        flags: Object.fromEntries(PERMISSION_FIELDS.map(field => [field, row.data[field] === true])),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return sha256(canonicalJson(rows));
  }
  const roleManifestBefore = roleManifest(row => row.data);
  const roleManifestAfter = roleManifest(row => simulated.get(`Users|${row.id}`) ?? row.data);
  if (roleManifestBefore !== roleManifestAfter) validationErrors.push('Current privileged User role/flag manifest changed');
  if (identityReviews.length > 0) validationErrors.push(`Unresolved operator decisions remain: ${identityReviews.length}`);

  for (const [sourceUserId, decision] of Object.entries(decisions.postWatermarkUsers)) {
    const target = mapping.get(`Users|${sourceUserId}`);
    const repaired = target ? simulated.get(`Users|${target.documentId}`) : undefined;
    if (!repaired) {
      validationErrors.push(`Approved post-watermark User missing from simulation: ${sourceUserId}`);
      continue;
    }
    if (normalizeEmail(repaired.email) !== normalizeEmail(decision.email)) {
      validationErrors.push(`Approved post-watermark User email mismatch: ${sourceUserId}`);
    }
    if (repaired.userId !== decision.assignedUserId || repaired.role !== 'User' || repaired.segment !== 'FOLK') {
      validationErrors.push(`Approved post-watermark User policy mismatch: ${sourceUserId}`);
    }
    if (PERMISSION_FIELDS.some(field => repaired[field] !== false)) {
      validationErrors.push(`Approved post-watermark User permission flag is not false: ${sourceUserId}`);
    }
    if (['uid', 'authUid', 'firebaseUid', 'firebaseAuthUid'].some(field => !isBlank(repaired[field]))) {
      validationErrors.push(`Approved post-watermark User unexpectedly has an Auth identifier: ${sourceUserId}`);
    }
  }

  for (const [missingSourceUserId, decision] of Object.entries(decisions.missingUserMappings)) {
    for (const sourceRow of sourceTables.get('Sadhana Entries') ?? []) {
      if (!values(sourceRow.User).includes(missingSourceUserId)) continue;
      const sourceMapping = mapping.get(`Sadhana Entries|${sourceRow.id}`);
      const repaired = simulated.get(`SadhanaEntries|${sourceRow.id}`) ??
        (sourceMapping ? simulated.get(`SadhanaEntries|${sourceMapping.documentId}`) : undefined);
      if (!repaired) validationErrors.push(`Approved-owner Sadhana missing from simulation: ${sourceRow.id}`);
      else if (!setEquals(repaired.user, decision.destinationUserId)) {
        validationErrors.push(`Approved-owner Sadhana owner mismatch: ${sourceRow.id}`);
      }
    }
  }

  for (const sourceGuide of sourceGuides) {
    const matches = [...simulated].filter(([key, data]) => key.startsWith('Guides|') && normalizeEmail(data.email) === normalizeEmail(sourceGuide.Email));
    if (matches.length !== 1) validationErrors.push(`Guide exact-email identity count is ${matches.length}: ${normalizeEmail(sourceGuide.Email)}`);
  }
  const simulatedVdnd = simulated.get(`Guides|${vdndGuide?.id ?? ''}`);
  if (simulatedVdnd && ['abbreviation', 'phone', 'id', 'migrationProvenance'].some(field => field in simulatedVdnd)) {
    validationErrors.push('Wrong-Guide contamination remains on vdnd@hkmmumbai.org');
  }
  const ashteshMapping = mapping.get('Users|30d2d239-c72c-49ec-b036-572852541c58');
  const sreeshMapping = mapping.get('Guides|9b438709-3d45-48a5-bb45-7cbff4a9ee75');
  if (ashteshMapping && sreeshMapping) {
    const repairedAshtesh = simulated.get(`Users|${ashteshMapping.documentId}`);
    if (!setEquals(repairedAshtesh?.guide, sreeshMapping.documentId)) validationErrors.push('Ashtesh Guide assignment is not repaired');
  }
  for (const sourceRow of sadhanaDelta.rows ?? []) {
    if (baseSadhanaIds.has(sourceRow.id)) continue;
    const owner = mappedTarget('Users', sourceRow.User);
    const repaired = simulated.get(`SadhanaEntries|${sourceRow.id}`);
    if (!repaired) validationErrors.push(`Post-watermark Sadhana missing from simulation: ${sourceRow.id}`);
    else if (owner.expected.length === 1 && !setEquals(repaired.user, owner.expected[0])) {
      validationErrors.push(`Post-watermark Sadhana owner mismatch: ${sourceRow.id}`);
    }
  }
  const writesByCollection = Object.fromEntries([...indexMany(orderedWrites, row => row.collection)]
    .map(([collection, rows]): [string, { creates: number; updates: number; fieldUpdates: number }] => [collection, {
      creates: rows.filter(row => row.operation === 'create').length,
      updates: rows.filter(row => row.operation === 'update').length,
      fieldUpdates: rows.reduce((sum, row) => sum + Object.keys(row.data).length + (row.deleteFields?.length ?? 0), 0),
    }]).sort((a, b) => a[0].localeCompare(b[0])));
  const relationshipFieldRepairs = orderedWrites
    .filter(row => row.reasons.includes('canonicalize-application-relationship'))
    .reduce((sum, row) => sum + Object.keys(row.data).length, 0);
  const summary = {
    kind: 'functional-migration-repair-dry-run',
    status: identityReviews.length === 0 ? 'APPROVAL_READY_FOR_REHEARSAL' : 'AWAITING_OPERATOR_DECISIONS',
    readOnly: true,
    repairRunId,
    generatedAt: new Date().toISOString(),
    sourceWatermark: userDelta.sourceWatermark,
    userDeltaCapturedAt: userDelta.capturedAt,
    sadhanaDeltaCapturedAt: sadhanaDelta.capturedAt,
    firestoreSnapshotCapturedAt: current.manifest.capturedAt,
    writes: orderedWrites.length,
    creates: orderedWrites.filter(row => row.operation === 'create').length,
    updates: orderedWrites.filter(row => row.operation === 'update').length,
    relationshipFieldRepairs,
    missingFolkSegments: orderedWrites.filter(row => row.reasons.includes('fill-missing-folk-segment')).length,
    postWatermarkUsersObserved: deltaSourceRefs.size - (sadhanaDelta.rows ?? []).filter((row: SourceRow) => !baseSadhanaIds.has(row.id)).length,
    postWatermarkUsersProposed: orderedWrites.filter(row => row.collection === 'Users' && row.operation === 'create').length,
    postWatermarkSadhana: (sadhanaDelta.rows ?? []).filter((row: SourceRow) => !baseSadhanaIds.has(row.id)).length,
    unresolvedRelationshipChecks: unresolvedRelationships.length,
    unresolvedSourceRecords: new Set(unresolvedRelationships.map(row => `${row.sourceTable}|${row.sourceRecordId}`)).size,
    missingHistoricalUserIdentities: missingIdentityRows.length,
    operatorReviewRows: identityReviews.length,
    acceptedLimitationRows: acceptedLimitations.length,
    approvedDecisionArtifact: {
      approvedAt: decisions.approvedAt,
      approvedBy: decisions.approvedBy,
      checksum: sha256(canonicalJson(decisions)),
    },
    validation: {
      passed: validationErrors.length === 0,
      errors: validationErrors,
      roleManifestUnchanged: roleManifestBefore === roleManifestAfter,
      noProtectedExistingUserUpdates: !validationErrors.some(error => error.startsWith('Protected existing User')),
      noLlpOrPushSubscriptionWrites: !validationErrors.some(error => error.startsWith('Forbidden collection write')),
      createAndUpdatePreconditionsValid: !validationErrors.some(error => /precondition|Create target exists/.test(error)),
    },
    writesByCollection,
    planHash: sha256(orderedWrites.map(canonicalJson).join('\n')),
  };

  writeJsonLines(path.join(repairDir, 'proposed-repair-writes.jsonl'), orderedWrites);
  writeJson(path.join(repairDir, 'repair-dry-run-summary.json'), summary);
  writeCsv(path.join(repairDir, 'unresolved-relationships.csv'), [
    'sourceTable', 'sourceRecordId', 'sourceField', 'targetTable', 'sourceTargetIds', 'unresolvedTargetIds', 'reason',
  ], unresolvedRelationships);
  writeCsv(path.join(repairDir, 'missing-historical-user-identities.csv'), [
    'missingZiteUserId', 'sadhanaRows', 'affectedTables', 'historicalEvidenceEmails',
    'historicalEvidencePhones', 'candidateCurrentUserIds', 'decision', 'warning',
  ], missingIdentityRows);
  writeCsv(path.join(repairDir, 'operator-decisions.csv'), [
    'kind', 'sourceTable', 'sourceRecordId', 'email', 'name', 'evidence', 'candidateCurrentUserIds',
  ], identityReviews);
  writeCsv(path.join(repairDir, 'accepted-limitations.csv'), [
    'kind', 'sourceTable', 'sourceRecordId', 'email', 'name', 'evidence', 'disposition', 'candidateCurrentUserIds',
  ], acceptedLimitations);
  writeCsv(path.join(repairDir, 'corrected-identity-ledger.csv'), [
    'sourceTable', 'sourceRecordId', 'destinationCollection', 'destinationDocumentId', 'rule',
  ], [...mapping].map(([sourceRef, target]) => {
    const split = sourceRef.indexOf('|');
    return { sourceTable: sourceRef.slice(0, split), sourceRecordId: sourceRef.slice(split + 1), ...target };
  }));

  const collectionRows = Object.entries(writesByCollection)
    .map(([collection, counts]: [string, any]) => `| ${collection} | ${counts.creates} | ${counts.updates} | ${counts.fieldUpdates} |`)
    .join('\n');
  const report = `# Functional migration repair dry-run\n\n` +
    `Status: **${summary.status}**\n\n` +
    `No Zite, Firebase Auth, or Firestore writes were made. This plan is bound to the Firestore update times captured at \`${summary.firestoreSnapshotCapturedAt}\`; any later change causes its write precondition to fail.\n\n` +
    `## Proposed scope\n\n` +
    `- ${summary.writes} document writes: ${summary.creates} creates and ${summary.updates} updates.\n` +
    `- ${summary.relationshipFieldRepairs} application relationship fields canonicalized to destination document IDs.\n` +
    `- ${summary.missingFolkSegments} existing Users receive \`segment: FOLK\` only where segment is currently blank.\n` +
    `- ${summary.postWatermarkUsersObserved} post-watermark User was observed; ${summary.postWatermarkUsersProposed} is proposed with an operator-approved replacement User ID. ${summary.postWatermarkSadhana} post-watermark Sadhana entries are included without creating Firebase Auth accounts.\n` +
    `- The mixed-person Guide record is cleaned, and the historical \`aggd.hkm@gmail.com\` Guide is separated as inactive without a duplicate Guide ID.\n` +
    `- Current roles, existing statuses, Auth aliases, and permission flags are otherwise untouched.\n\n` +
    `Dry-run invariant validation: **${summary.validation.passed ? 'PASSED' : 'FAILED'}**.\n\n` +
    `| Collection | Creates | Updates | Fields changed |\n|---|---:|---:|---:|\n${collectionRows}\n\n` +
    `## Approved limitations and remaining review\n\n` +
    `- ${summary.missingHistoricalUserIdentities} deleted/unavailable Zite User IDs remain archive-only because no approved exact-email identity exists.\n` +
    `- ${summary.unresolvedRelationshipChecks} required relationship checks across ${summary.unresolvedSourceRecords} source records remain archive-only or source-incomplete.\n` +
    `- ${summary.acceptedLimitationRows} policy-controlled limitations are recorded in \`accepted-limitations.csv\`.\n` +
    `- ${summary.operatorReviewRows} unresolved operator decisions remain in \`operator-decisions.csv\`.\n` +
    `- Historical Guide emails lacking current Auth/Guide capability remain inactive. No Auth user or role elevation is proposed.\n\n` +
    `## Safety gates before apply\n\n` +
    `1. Stop or freeze Zite writes and capture a final delta.\n` +
    `2. Resolve \`missing-historical-user-identities.csv\` and \`operator-decisions.csv\`.\n` +
    `3. Take a fresh managed Firestore backup and restore-rehearse it.\n` +
    `4. Regenerate this plan against a new Firestore snapshot and require the same reviewed scope.\n` +
    `5. Run a rehearsal, then obtain explicit final approval for the exact plan hash.\n` +
    `6. Apply with update-time/create-only preconditions and run authenticated Guide/member functional tests.\n\n` +
    `Plan hash: \`${summary.planHash}\`\n`;
  fs.writeFileSync(path.join(repairDir, 'REPAIR_DRY_RUN.md'), report);
  if (!summary.validation.passed) throw new Error(`Repair dry-run invariant validation failed: ${validationErrors.join('; ')}`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
