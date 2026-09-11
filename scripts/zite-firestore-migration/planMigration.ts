/* eslint-disable @typescript-eslint/no-explicit-any -- migration snapshots contain heterogeneous external JSON values */
import fs from 'node:fs';
import path from 'node:path';
import {
  ARCHIVE_CHUNKS_COLLECTION,
  ARCHIVE_COLLECTION,
  CANONICAL_USER_NAMES_BY_EMAIL,
  LEDGER_COLLECTION,
  NON_BLOCKING_MIGRATION_ASSERTIONS,
  PERMISSION_FIELDS,
  PRIVILEGED_ROLES,
  PROTECTED_USER_FIELDS,
  RUN_COLLECTION,
  SOURCE_SYSTEM,
  SOURCE_TABLES,
  SourceTableConfig,
  assertStaticConfiguration,
} from './config';
import {
  canonicalJson,
  comparable,
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

interface SnapshotManifest {
  checksum?: string;
  capturedAt: string;
  tables: Array<{
    source?: string;
    collection?: string;
    disposition?: string;
    file?: string;
    count: number;
    exportedCount?: number;
    observedCount?: number;
    checksum?: string;
  }>;
  tombstonesIncluded?: boolean;
  attachmentBytesVerified?: boolean;
}

interface FirestoreSnapshotRow {
  id: string;
  createTime?: string;
  updateTime?: string;
  data: Record<string, any>;
}

interface SourceRow extends Record<string, any> {
  id: string;
}

interface LedgerRow {
  sourceSystem: string;
  sourceTable: string;
  sourceRecordId: string;
  sourceBusinessId: string | null;
  destinationCollection: string;
  destinationDocumentId: string;
  matchRule: string;
  action: 'create' | 'enrich' | 'no-op' | 'archive' | 'limitation' | 'review';
  sourceChecksum: string;
  runId: string;
  reviewReason?: string;
}

interface PlannedWrite {
  phase: number;
  operation: 'create' | 'update';
  collection: string;
  documentId: string;
  data: Record<string, any>;
  precondition: { exists: false } | { updateTime: string };
  sourceTable?: string;
  sourceRecordId?: string;
}

const SYSTEM_SOURCE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'source_metadata',
  'autonumber_id',
]);

const ARCHIVE_CHUNK_BYTES = 480_000;

const REQUIRED_LINK_FIELDS: Record<string, string[]> = {
  'Sadhana Entries': ['User'],
  'BV Group Members': ['User', 'Group'],
  'BV Attendance': ['Session', 'User'],
  'BVSL Preaching Entries': ['User', 'Sadhana Entry'],
  'Service Allocations': ['Service', 'User'],
  'Service Availability': ['User'],
  'Service Swaps': ['Allocation', 'From User'],
  'User Skills': ['User', 'Skill'],
  'Ashray Checklist': ['User'],
  'Residency Transfer Requests': ['User'],
  'Guide Transfer Requests': ['User', 'From Guide', 'To Guide'],
  'BvQuizSubmissions': ['User', 'Quiz'],
  'ServiceRatings': ['Service'],
  'Unavailability Requests': ['User', 'Service Allocation'],
  'Sadhana Monthly Summaries': ['User'],
  'One To One Meetings': ['Guide', 'Member'],
  'BVSL Weekly Plans': ['User'],
  'Jigyasa Session Attendance': ['Registration'],
  'Cleanliness Inspections': ['Room', 'Inspector', 'Residency'],
  'Cleanliness Review Requests': ['User', 'Room', 'Inspection'],
};

function uniqueIndex<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    const bucket = result.get(key) ?? [];
    bucket.push(item);
    result.set(key, bucket);
  }
  return result;
}

function destinationId(sourceTable: string, sourceId: string): string {
  if (sourceId && !sourceId.includes('/') && Buffer.byteLength(sourceId, 'utf8') <= 1_200) return sourceId;
  return `zite_${sha256(`${SOURCE_SYSTEM}|${sourceTable}|${sourceId}`).slice(0, 40)}`;
}

function archiveId(sourceTable: string, sourceId: string): string {
  return sha256(`${SOURCE_SYSTEM}|${sourceTable}|${sourceId}`);
}

function loadFirestoreTables(runDir: string, manifest: SnapshotManifest): Map<string, FirestoreSnapshotRow[]> {
  const result = new Map<string, FirestoreSnapshotRow[]>();
  for (const table of manifest.tables) {
    if (!table.collection || !table.file) continue;
    result.set(table.collection, readJsonLines(path.join(runDir, 'firestore', table.file)) as FirestoreSnapshotRow[]);
  }
  return result;
}

function loadSourceTables(runDir: string, manifest: SnapshotManifest): Map<string, SourceRow[]> {
  const result = new Map<string, SourceRow[]>();
  for (const table of manifest.tables) {
    if (!table.source || !table.file) continue;
    result.set(table.source, readJsonLines(path.join(runDir, 'zite', table.file)) as SourceRow[]);
  }
  return result;
}

function loadSchema(runDir: string): Map<string, any> {
  const schemaPath = path.join(runDir, 'zite', 'schema.jsonl');
  const result = new Map<string, any>();
  for (const table of readJsonLines(schemaPath)) result.set(table.name, table);
  return result;
}

function currentFieldLookup(rows: FirestoreSnapshotRow[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const key of Object.keys(row.data ?? {})) {
      const normalized = normalizedFieldName(key);
      const variants = counts.get(normalized) ?? new Map<string, number>();
      variants.set(key, (variants.get(key) ?? 0) + 1);
      counts.set(normalized, variants);
    }
  }
  return new Map(
    [...counts].map(([normalized, variants]) => [
      normalized,
      [...variants].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    ]),
  );
}

function destinationField(sourceField: string, lookup: Map<string, string>): string {
  return lookup.get(normalizedFieldName(sourceField)) ?? sourceFieldToCamelCase(sourceField);
}

function keyForSource(row: SourceRow, fields: string[]): string {
  const values = fields.map((field) => comparable(row[field]));
  return values.every(Boolean) ? values.join('|') : '';
}

function keyForDestination(row: FirestoreSnapshotRow, fields: string[], lookup: Map<string, string>): string {
  const values = fields.map((field) => comparable(row.data[destinationField(field, lookup)]));
  return values.every(Boolean) ? values.join('|') : '';
}

function sourceBusinessId(config: SourceTableConfig, row: SourceRow): string | null {
  for (const key of config.businessKeys ?? []) {
    if (key.length !== 1) continue;
    const value = row[key[0]];
    if (!isBlank(value) && !Array.isArray(value)) return String(value);
  }
  return null;
}

function isBlankUser(row: SourceRow): boolean {
  return ['Full Name', 'User ID', 'Email', 'Phone', 'Role', 'Status'].every((field) => isBlank(row[field]));
}

function isPrivileged(data: Record<string, any>): boolean {
  if (PRIVILEGED_ROLES.has(String(data.role ?? '').trim().toLowerCase())) return true;
  return PERMISSION_FIELDS.some((field) => data[field] === true);
}

function approvedRoleManifest(currentUsers: FirestoreSnapshotRow[]): any[] {
  return currentUsers
    .filter((user) => normalizeEmail(user.data.email) && isPrivileged(user.data))
    .map((user) => ({
      documentId: user.id,
      email: normalizeEmail(user.data.email),
      role: user.data.role ?? null,
      flags: Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, user.data[field] === true])),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function writeForCreate(
  writes: PlannedWrite[],
  phase: number,
  collection: string,
  documentId: string,
  data: Record<string, any>,
  sourceTable?: string,
  sourceRecordId?: string,
): void {
  writes.push({
    phase,
    operation: 'create',
    collection,
    documentId,
    data,
    precondition: { exists: false },
    sourceTable,
    sourceRecordId,
  });
}

function addArchiveWrites(
  writes: PlannedWrite[],
  existingArchives: Map<string, FirestoreSnapshotRow>,
  runId: string,
  table: string,
  row: SourceRow,
): void {
  const id = archiveId(table, row.id);
  const checksum = sha256(canonicalJson(row));
  const existing = existingArchives.get(id);
  if (existing?.data?.sourceChecksum === checksum) return;
  if (existing) throw new Error(`Immutable archive collision for ${table}/${row.id}`);
  const rawJson = canonicalJson(row);
  const common = {
    sourceSystem: SOURCE_SYSTEM,
    sourceTable: table,
    sourceRecordId: row.id,
    sourceChecksum: checksum,
    sourceCreatedAt: row.created_at ?? null,
    sourceUpdatedAt: row.updated_at ?? null,
    operationallyRestored: false,
    runId,
  };
  if (Buffer.byteLength(rawJson, 'utf8') <= ARCHIVE_CHUNK_BYTES) {
    writeForCreate(writes, 1, ARCHIVE_COLLECTION, id, { ...common, sourceData: row }, table, row.id);
    return;
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < rawJson.length; offset += ARCHIVE_CHUNK_BYTES) {
    chunks.push(rawJson.slice(offset, offset + ARCHIVE_CHUNK_BYTES));
  }
  writeForCreate(writes, 1, ARCHIVE_COLLECTION, id, { ...common, chunkCount: chunks.length }, table, row.id);
  chunks.forEach((chunk, index) => writeForCreate(
    writes,
    1,
    ARCHIVE_CHUNKS_COLLECTION,
    `${id}_${String(index).padStart(4, '0')}`,
    { archiveId: id, index, data: chunk, checksum: sha256(chunk), runId },
    table,
    row.id,
  ));
}

function main(): void {
  assertStaticConfiguration();
  const runDirArg = process.argv[2];
  if (!runDirArg) throw new Error('Usage: npx tsx planMigration.ts <run-directory>');
  const runDir = path.resolve(runDirArg);
  const outputDir = path.join(runDir, 'dry-run');
  if (fs.existsSync(path.join(outputDir, 'reconciliation-summary.json'))) {
    throw new Error(`Refusing to overwrite an existing dry-run: ${outputDir}`);
  }

  const ziteManifest = readJson<SnapshotManifest>(path.join(runDir, 'zite', 'manifest.json'));
  const firestoreManifest = readJson<SnapshotManifest>(path.join(runDir, 'firestore', 'manifest.json'));
  const sourceTables = loadSourceTables(runDir, ziteManifest);
  const currentTables = loadFirestoreTables(runDir, firestoreManifest);
  const schema = loadSchema(runDir);

  const currentUsers = currentTables.get('Users') ?? [];
  const roleManifest = approvedRoleManifest(currentUsers);
  const roleManifestChecksum = sha256(canonicalJson(roleManifest));
  const runId = `mig_${sha256(canonicalJson({
    source: ziteManifest.checksum,
    destination: firestoreManifest.checksum,
    roleManifestChecksum,
  })).slice(0, 24)}`;

  const ledgers: LedgerRow[] = [];
  const ledgerBySource = new Map<string, LedgerRow>();
  const tableStats = new Map<string, Record<string, number>>();
  const userMatching: any[] = [];
  const roleValidation: any[] = [];
  const conflicts: any[] = [];
  const relationships: any[] = [];
  const riskRows: any[] = [];
  const recoveredLinks = new Map<string, string[]>();
  const recoveredFieldsByRow = new Map<string, Set<string>>();

  for (const config of SOURCE_TABLES) {
    const sourceRows = sourceTables.get(config.source) ?? [];
    const currentRows = config.destination ? currentTables.get(config.destination) ?? [] : [];
    const stats = { source: sourceRows.length, current: currentRows.length, create: 0, enrich: 0, noop: 0, archive: 0, limitation: 0, review: 0, exclude: 0 };
    tableStats.set(config.source, stats);

    if (config.disposition === 'exclude') {
      const manifestTable = ziteManifest.tables.find((table) => table.source === config.source);
      if (manifestTable?.file || (manifestTable?.exportedCount ?? 0) !== 0 || sourceRows.length !== 0) {
        throw new Error(`LLP exclusion violation: ${config.source} was exported into migration input`);
      }
      stats.exclude = manifestTable?.observedCount ?? manifestTable?.count ?? 0;
      continue;
    }

    const lookup = currentFieldLookup(currentRows);
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    const sourceKeyCounts = new Map<string, number>();
    const currentIndexes = new Map<string, Map<string, FirestoreSnapshotRow[]>>();
    for (const fields of config.businessKeys ?? []) {
      const label = fields.join('+');
      for (const row of sourceRows) {
        const key = keyForSource(row, fields);
        if (key) sourceKeyCounts.set(`${label}|${key}`, (sourceKeyCounts.get(`${label}|${key}`) ?? 0) + 1);
      }
      currentIndexes.set(label, uniqueIndex(currentRows, (row) => keyForDestination(row, fields, lookup)));
    }

    const currentUsersByEmail = config.source === 'Users'
      ? uniqueIndex(currentRows, (row) => normalizeEmail(row.data.email))
      : new Map<string, FirestoreSnapshotRow[]>();
    const sourceUsersByEmail = config.source === 'Users'
      ? uniqueIndex(sourceRows, (row) => normalizeEmail(row.Email))
      : new Map<string, SourceRow[]>();

    for (const sourceRow of sourceRows) {
      if (!sourceRow.id) throw new Error(`Source record without system id in ${config.source}`);
      const checksum = sha256(canonicalJson(sourceRow));
      const archiveDocumentId = archiveId(config.source, sourceRow.id);

      if (config.disposition === 'archive_only' || (config.source === 'Users' && isBlankUser(sourceRow))) {
        const ledger: LedgerRow = {
          sourceSystem: SOURCE_SYSTEM,
          sourceTable: config.source,
          sourceRecordId: sourceRow.id,
          sourceBusinessId: sourceBusinessId(config, sourceRow),
          destinationCollection: ARCHIVE_COLLECTION,
          destinationDocumentId: archiveDocumentId,
          matchRule: config.disposition === 'archive_only' ? 'archive-policy' : 'blank-user-policy',
          action: 'archive',
          sourceChecksum: checksum,
          runId,
        };
        ledgers.push(ledger);
        ledgerBySource.set(`${config.source}|${sourceRow.id}`, ledger);
        stats.archive += 1;
        if (config.source === 'Users') {
          userMatching.push({ sourceRecordId: sourceRow.id, email: '', destinationDocumentId: '', matchType: 'blank-user-policy', action: 'archive', reviewReason: '' });
        }
        continue;
      }

      let matched: FirestoreSnapshotRow | undefined;
      let matchRule = '';
      let reviewReason = '';

      if (config.source === 'Users') {
        const email = normalizeEmail(sourceRow.Email);
        if (!email) {
          reviewReason = 'Nonblank user has no email; operational identity requires manual review';
        } else if ((sourceUsersByEmail.get(email)?.length ?? 0) !== 1) {
          reviewReason = 'Duplicate normalized source email';
        } else if ((currentUsersByEmail.get(email)?.length ?? 0) > 1) {
          reviewReason = 'Duplicate normalized destination email';
        } else {
          matched = currentUsersByEmail.get(email)?.[0];
          matchRule = matched ? 'exact-normalized-email' : 'create-exact-email-unmatched';
        }
      } else {
        const idMatch = currentById.get(sourceRow.id);
        if (idMatch) {
          const contradictoryKey = (config.businessKeys ?? []).some((fields) => {
            const sourceKey = keyForSource(sourceRow, fields);
            const currentKey = keyForDestination(idMatch, fields, lookup);
            return sourceKey && currentKey && sourceKey !== currentKey;
          });
          if (!contradictoryKey) {
            matched = idMatch;
            matchRule = 'source-system-id';
          } else {
            matchRule = 'deterministic-collision-id';
          }
        }
        if (!matched && matchRule !== 'deterministic-collision-id') {
          for (const fields of config.businessKeys ?? []) {
            const label = fields.join('+');
            const key = keyForSource(sourceRow, fields);
            if (!key || sourceKeyCounts.get(`${label}|${key}`) !== 1) continue;
            const candidates = currentIndexes.get(label)?.get(key) ?? [];
            if (candidates.length === 1) {
              matched = candidates[0];
              matchRule = `business-key:${label}`;
              break;
            }
            if (candidates.length > 1) {
              reviewReason = `Ambiguous destination business key: ${label}`;
              break;
            }
          }
        }
        if (!matched && !matchRule && !reviewReason) matchRule = 'create-source-system-id';
      }

      const docId = matched?.id ?? (
        matchRule === 'deterministic-collision-id'
          ? `zite_${sha256(`${SOURCE_SYSTEM}|${config.source}|${sourceRow.id}`).slice(0, 40)}`
          : destinationId(config.source, sourceRow.id)
      );
      const ledger: LedgerRow = {
        sourceSystem: SOURCE_SYSTEM,
        sourceTable: config.source,
        sourceRecordId: sourceRow.id,
        sourceBusinessId: sourceBusinessId(config, sourceRow),
        destinationCollection: config.destination!,
        destinationDocumentId: reviewReason ? '' : docId,
        matchRule: reviewReason ? 'manual-review' : matchRule,
        action: reviewReason ? 'review' : matched ? 'no-op' : 'create',
        sourceChecksum: checksum,
        runId,
        ...(reviewReason ? { reviewReason } : {}),
      };
      ledgers.push(ledger);
      ledgerBySource.set(`${config.source}|${sourceRow.id}`, ledger);
      if (reviewReason) {
        stats.review += 1;
        riskRows.push({ severity: 'high', sourceTable: config.source, sourceRecordId: sourceRow.id, finding: reviewReason, treatment: 'Preserve archive; no operational write pending approval' });
      } else if (!matched) {
        stats.create += 1;
      }
      if (config.source === 'Users') {
        userMatching.push({
          sourceRecordId: sourceRow.id,
          email: normalizeEmail(sourceRow.Email),
          destinationDocumentId: ledger.destinationDocumentId,
          matchType: ledger.matchRule,
          action: ledger.action,
          reviewReason,
        });
      }
    }
  }

  const currentByCollectionAndId = new Map<string, FirestoreSnapshotRow>();
  for (const [collection, rows] of currentTables) {
    for (const row of rows) currentByCollectionAndId.set(`${collection}|${row.id}`, row);
  }

  // The legacy BVSL rows omitted their direct Sadhana Entry link, but every row in
  // this snapshot has one unique same-user/same-day Sadhana entry. Recover only
  // this deterministic relationship; never use a name or phone fallback.
  const sadhanaByUserDate = uniqueIndex(sourceTables.get('Sadhana Entries') ?? [], (row) => {
    const user = Array.isArray(row.User) ? row.User[0] : row.User;
    const date = String(row['Entry Date'] ?? '').slice(0, 10);
    return user && date ? `${user}|${date}` : '';
  });
  for (const row of sourceTables.get('BVSL Preaching Entries') ?? []) {
    if (!isBlank(row['Sadhana Entry']) && !(Array.isArray(row['Sadhana Entry']) && row['Sadhana Entry'].length === 0)) continue;
    const user = Array.isArray(row.User) ? row.User[0] : row.User;
    const date = String(row['Entry Date'] ?? '').slice(0, 10);
    const candidates = sadhanaByUserDate.get(user && date ? `${user}|${date}` : '') ?? [];
    if (candidates.length === 1) {
      recoveredLinks.set(`BVSL Preaching Entries|${row.id}|Sadhana Entry`, [candidates[0].id]);
      recoveredFieldsByRow.set(`BVSL Preaching Entries|${row.id}`, new Set(['Sadhana Entry']));
    }
  }

  // Required absent endpoints are manual-review rows. They remain immutable in
  // the archive and cannot create incomplete operational records.
  for (const [table, requiredFields] of Object.entries(REQUIRED_LINK_FIELDS)) {
    const config = SOURCE_TABLES.find((entry) => entry.source === table)!;
    const lookup = currentFieldLookup(config.destination ? currentTables.get(config.destination) ?? [] : []);
    const fieldSchemas = new Map((schema.get(table)?.fields ?? []).map((field: any) => [field.name, field]));
    for (const row of sourceTables.get(table) ?? []) {
      const ledger = ledgerBySource.get(`${table}|${row.id}`);
      if (!ledger || ledger.action === 'archive' || ledger.action === 'limitation' || ledger.action === 'review') continue;
      const current = currentByCollectionAndId.get(`${ledger.destinationCollection}|${ledger.destinationDocumentId}`);
      const missing = requiredFields.flatMap((field) => {
        const currentValue = current?.data[destinationField(field, lookup)];
        if (!isBlank(currentValue) && (!Array.isArray(currentValue) || currentValue.length > 0)) return [];
        const value = recoveredLinks.get(`${table}|${row.id}|${field}`) ?? row[field];
        if (isBlank(value) || (Array.isArray(value) && value.length === 0)) return [field];
        const fieldSchema: any = fieldSchemas.get(field);
        if (!fieldSchema?.linksTo) return [`${field} (schema target unavailable)`];
        const sourceIds = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
        const allTargetsResolved = sourceIds.every((sourceId) => {
          const target = ledgerBySource.get(`${fieldSchema.linksTo}|${sourceId}`);
          return target?.destinationDocumentId && target.action !== 'review' && target.action !== 'limitation' && target.action !== 'archive';
        });
        return allTargetsResolved ? [] : [`${field} (target unavailable)`];
      });
      if (missing.length === 0) continue;
      const stats = tableStats.get(table)!;
      if (ledger.action === 'create') stats.create -= 1;
      const unavailableTargetLimitation = missing.every((field) => field.endsWith('(target unavailable)'));
      stats.limitation += 1;
      ledger.action = 'limitation';
      ledger.matchRule = unavailableTargetLimitation
        ? 'unavailable-target-limitation'
        : 'malformed-active-row-archive-policy';
      ledger.reviewReason = `Missing required relationship: ${missing.join(', ')}`;
      ledger.destinationDocumentId = '';
      riskRows.push({
        severity: 'limitation',
        sourceTable: table,
        sourceRecordId: row.id,
        finding: ledger.reviewReason,
        treatment: unavailableTargetLimitation
          ? 'Preserve archive only; do not recreate or activate the unavailable target; optionally reconcile future PITR history'
          : 'Preserve malformed active row in archive only; do not create an incomplete operational document',
      });
    }
  }

  const writes: PlannedWrite[] = [];
  const existingArchives = new Map((currentTables.get(ARCHIVE_COLLECTION) ?? []).map((row) => [row.id, row]));
  const existingLedgers = new Map((currentTables.get(LEDGER_COLLECTION) ?? []).map((row) => [row.id, row]));
  for (const config of SOURCE_TABLES) {
    if (config.disposition === 'exclude') continue;
    const sourceRows = sourceTables.get(config.source) ?? [];
    const currentRows = config.destination ? currentTables.get(config.destination) ?? [] : [];
    const lookup = currentFieldLookup(currentRows);
    const fieldsByName = new Map((schema.get(config.source)?.fields ?? []).map((field: any) => [field.name, field]));

    for (const sourceRow of sourceRows) {
      addArchiveWrites(writes, existingArchives, runId, config.source, sourceRow);
      const ledger = ledgerBySource.get(`${config.source}|${sourceRow.id}`)!;
      const ledgerId = archiveId(config.source, sourceRow.id);
      const existingLedger = existingLedgers.get(ledgerId);
      if (!existingLedger) writeForCreate(writes, 2, LEDGER_COLLECTION, ledgerId, ledger, config.source, sourceRow.id);
      else if (existingLedger.data.sourceChecksum !== ledger.sourceChecksum || existingLedger.data.destinationDocumentId !== ledger.destinationDocumentId) {
        throw new Error(`Immutable ledger collision for ${config.source}/${sourceRow.id}`);
      }
      if (ledger.action === 'archive' || ledger.action === 'limitation' || ledger.action === 'review') continue;

      const existing = currentByCollectionAndId.get(`${ledger.destinationCollection}|${ledger.destinationDocumentId}`);
      const transformed: Record<string, any> = {};
      const sourceFields = new Set([
        ...Object.keys(sourceRow),
        ...(recoveredFieldsByRow.get(`${config.source}|${sourceRow.id}`) ?? []),
      ]);
      for (const sourceField of sourceFields) {
        const rawValue = recoveredLinks.get(`${config.source}|${sourceRow.id}|${sourceField}`) ?? sourceRow[sourceField];
        if (SYSTEM_SOURCE_FIELDS.has(sourceField) || isBlank(rawValue)) continue;
        const fieldSchema: any = fieldsByName.get(sourceField);
        const destinationKey = destinationField(sourceField, lookup);
        let value = rawValue;
        if (fieldSchema?.type === 'linked_record') {
          const sourceIds = (Array.isArray(rawValue) ? rawValue : [rawValue]).map(String).filter(Boolean);
          const mapped = sourceIds.map((sourceId) => ledgerBySource.get(`${fieldSchema.linksTo}|${sourceId}`));
          mapped.forEach((target, index) => relationships.push({
            sourceTable: config.source,
            sourceRecordId: sourceRow.id,
            field: sourceField,
            targetTable: fieldSchema.linksTo,
            targetSourceRecordId: sourceIds[index],
            targetDestinationDocumentId: target?.destinationDocumentId ?? '',
            status: target?.destinationDocumentId && target.action !== 'review' && target.action !== 'limitation' && target.action !== 'archive' ? 'mapped' : 'unresolved',
          }));
          if (mapped.some((target) => !target?.destinationDocumentId || target.action === 'review' || target.action === 'limitation' || target.action === 'archive')) continue;
          const mappedIds = mapped.map((target) => target!.destinationDocumentId);
          value = mappedIds.length === 1 ? mappedIds[0] : mappedIds;
        }
        transformed[destinationKey] = value;
      }

      if (config.source === 'Users') {
        const canonicalName = CANONICAL_USER_NAMES_BY_EMAIL[
          normalizeEmail(transformed.email ?? sourceRow.Email ?? existing?.data.email)
        ];
        if (canonicalName) transformed.fullName = canonicalName;
        if (!existing) {
          transformed.role = 'User';
          for (const field of PERMISSION_FIELDS) transformed[field] = false;
        } else {
          for (const field of PROTECTED_USER_FIELDS) delete transformed[field];
        }
      }
      if (config.source === 'Guides' && !existing) transformed.isActive = false;
      transformed.id = ledger.destinationDocumentId;
      transformed.migrationProvenance = {
        sourceSystem: SOURCE_SYSTEM,
        sourceTable: config.source,
        sourceRecordId: sourceRow.id,
        sourceChecksum: ledger.sourceChecksum,
        runId,
      };

      if (!existing) {
        writeForCreate(writes, 3, ledger.destinationCollection, ledger.destinationDocumentId, transformed, config.source, sourceRow.id);
        continue;
      }

      const patch: Record<string, any> = {};
      for (const [key, sourceValue] of Object.entries(transformed)) {
        const currentValue = existing.data[key];
        if (isBlank(currentValue) && !isBlank(sourceValue)) patch[key] = sourceValue;
        else if (!isBlank(currentValue) && !isBlank(sourceValue) && comparable(currentValue) !== comparable(sourceValue)) {
          conflicts.push({
            sourceTable: config.source,
            sourceRecordId: sourceRow.id,
            destinationCollection: ledger.destinationCollection,
            destinationDocumentId: ledger.destinationDocumentId,
            field: key,
            currentValueHash: sha256(canonicalJson(currentValue)),
            sourceValueHash: sha256(canonicalJson(sourceValue)),
            winner: 'current',
          });
        }
      }
      if (Object.keys(patch).length > 0) {
        if (!existing.updateTime) throw new Error(`Missing update-time precondition for ${ledger.destinationCollection}/${ledger.destinationDocumentId}`);
        writes.push({
          phase: 3,
          operation: 'update',
          collection: ledger.destinationCollection,
          documentId: ledger.destinationDocumentId,
          data: patch,
          precondition: { updateTime: existing.updateTime },
          sourceTable: config.source,
          sourceRecordId: sourceRow.id,
        });
        ledger.action = 'enrich';
        tableStats.get(config.source)!.enrich += 1;
      } else {
        ledger.action = 'no-op';
        tableStats.get(config.source)!.noop += 1;
      }
    }
  }

  for (const sourceUser of sourceTables.get('Users') ?? []) {
    const ledger = ledgerBySource.get(`Users|${sourceUser.id}`)!;
    const current = ledger.destinationDocumentId
      ? currentByCollectionAndId.get(`Users|${ledger.destinationDocumentId}`)
      : undefined;
    roleValidation.push({
      email: normalizeEmail(sourceUser.Email),
      sourceRole: sourceUser.Role ?? null,
      currentRole: current?.data.role ?? null,
      finalRole: current?.data.role ?? (ledger.action === 'create' ? 'User' : null),
      finalPermissionFlags: current
        ? Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, current.data[field] === true]))
        : Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, false])),
      action: ledger.action,
    });
  }
  const sourceEmails = new Set((sourceTables.get('Users') ?? []).map((row) => normalizeEmail(row.Email)).filter(Boolean));
  for (const current of currentUsers.filter((row) => !sourceEmails.has(normalizeEmail(row.data.email)))) {
    roleValidation.push({
      email: normalizeEmail(current.data.email),
      sourceRole: null,
      currentRole: current.data.role ?? null,
      finalRole: current.data.role ?? null,
      finalPermissionFlags: Object.fromEntries(PERMISSION_FIELDS.map((field) => [field, current.data[field] === true])),
      action: 'current-only-unchanged',
    });
  }

  const plannedOperationalPushWrites = writes.filter((write) => write.collection === 'PushSubscriptions' && write.sourceTable === 'Push Subscriptions');
  const llpWrites = writes.filter((write) => /^LLP/i.test(write.sourceTable ?? ''));
  const unresolvedRelationships = relationships.filter((row) => row.status === 'unresolved');
  const reviewLedgers = ledgers.filter((row) => row.action === 'review');
  const limitationLedgers = ledgers.filter((row) => row.action === 'limitation');
  const unavailableTargetLimitationLedgers = limitationLedgers.filter((row) => row.matchRule === 'unavailable-target-limitation');
  const malformedActiveLimitationLedgers = limitationLedgers.filter((row) => row.matchRule === 'malformed-active-row-archive-policy');
  const assertions = {
    sourceTableDecisionsExactly62: SOURCE_TABLES.length === 62,
    llpExportedRowsZero: SOURCE_TABLES.filter((table) => table.disposition === 'exclude').every((config) => {
      const table = ziteManifest.tables.find((entry) => entry.source === config.source);
      return !table?.file && (table?.exportedCount ?? 0) === 0;
    }),
    llpPlannedWritesZero: llpWrites.length === 0,
    legacyPushOperationalWritesZero: plannedOperationalPushWrites.length === 0,
    currentDocumentsDeletedZero: writes.every((write) => write.operation !== ('delete' as any)),
    ziteOnlyUsersUnprivileged: roleValidation
      .filter((row) => row.action === 'create')
      .every((row) => row.finalRole === 'User' && Object.values(row.finalPermissionFlags).every((value) => value === false)),
    roleManifestFrozen: true,
    allOperationalRelationshipsResolved: unresolvedRelationships.length === 0,
    manualReviewEmpty: reviewLedgers.length === 0,
    restorableFirestoreBackupVerified: (firestoreManifest as any).managedBackupVerified === true,
    tombstonesAvailable: ziteManifest.tombstonesIncluded === true,
    attachmentBytesVerified: ziteManifest.attachmentBytesVerified === true,
    preconditionsOnEveryOperationalUpdate: writes
      .filter((write) => write.operation === 'update')
      .every((write) => 'updateTime' in write.precondition),
  };
  if (!assertions.llpExportedRowsZero || !assertions.llpPlannedWritesZero || !assertions.legacyPushOperationalWritesZero || !assertions.ziteOnlyUsersUnprivileged) {
    throw new Error(`Critical migration firewall failed: ${canonicalJson(assertions)}`);
  }

  for (const row of unresolvedRelationships) {
    riskRows.push({ severity: 'limitation', sourceTable: row.sourceTable, sourceRecordId: row.sourceRecordId, finding: `Unresolved optional ${row.field} -> ${row.targetTable}/${row.targetSourceRecordId}`, treatment: 'Preserve archive and omit the optional operational relationship; optionally reconcile future PITR history' });
  }
  if (!assertions.tombstonesAvailable) riskRows.push({
    severity: 'limitation',
    sourceTable: '',
    sourceRecordId: '',
    finding: 'Soft-deleted Zite rows are unavailable through the active-row export',
    treatment: 'Do not recreate or activate deleted records; optionally reconcile a future PITR or administrative export into archive-only history',
  });
  if (!assertions.restorableFirestoreBackupVerified) riskRows.push({ severity: 'blocker', sourceTable: '', sourceRecordId: '', finding: 'No restorable managed Firestore backup is attached to this run', treatment: 'Create a managed export and complete an isolated restore rehearsal before production apply' });
  if (!assertions.attachmentBytesVerified) riskRows.push({ severity: 'blocker', sourceTable: '', sourceRecordId: '', finding: 'Attachment bytes and checksums are not yet verified', treatment: 'Download permitted non-LLP attachments and verify checksums/readability before production apply' });

  const tableMigrationRows = SOURCE_TABLES.map((config) => {
    const stats = tableStats.get(config.source)!;
    return {
      sourceTable: config.source,
      disposition: config.disposition,
      destination: config.destination ?? ARCHIVE_COLLECTION,
      sourceCount: stats.source,
      currentCount: stats.current,
      create: stats.create,
      enrich: stats.enrich,
      noOp: stats.noop,
      archive: stats.archive,
      limitation: stats.limitation,
      review: stats.review,
      exclude: stats.exclude,
      expectedFinalCount: stats.current + stats.create,
    };
  });

  const summary = {
    kind: 'migration-dry-run',
    runId,
    generatedAt: new Date().toISOString(),
    sourceSnapshotChecksum: ziteManifest.checksum ?? null,
    destinationSnapshotChecksum: firestoreManifest.checksum ?? null,
    approvedRoleManifestChecksum: roleManifestChecksum,
    approvedRoleCount: roleManifest.length,
    sourceRows: [...sourceTables.values()].reduce((total, rows) => total + rows.length, 0),
    ledgerRows: ledgers.length,
    plannedWrites: writes.length + 1,
    operationalCreates: writes.filter((write) => write.phase === 3 && write.operation === 'create').length,
    operationalUpdates: writes.filter((write) => write.phase === 3 && write.operation === 'update').length,
    archiveWrites: writes.filter((write) => write.phase === 1).length,
    ledgerWrites: writes.filter((write) => write.phase === 2).length,
    manualReviewRows: reviewLedgers.length,
    unavailableTargetLimitationRows: unavailableTargetLimitationLedgers.length,
    malformedActiveArchiveOnlyRows: malformedActiveLimitationLedgers.length,
    unresolvedRelationships: unresolvedRelationships.length,
    fieldConflictsCurrentWins: conflicts.length,
    assertions,
    approvalReady: Object.entries(assertions)
      .filter(([name]) => !NON_BLOCKING_MIGRATION_ASSERTIONS.has(name))
      .every(([, passed]) => passed),
    limitations: {
      softDeletedRecordsUnavailable: !assertions.tombstonesAvailable,
      softDeletedRecordsOperationallyRestored: false,
      futurePitrExportSupported: true,
    },
  };

  writeJson(outputDir + '/approved-role-map.json', { runId, checksum: roleManifestChecksum, users: roleManifest });
  writeCsv(outputDir + '/user-matching.csv', ['sourceRecordId', 'email', 'destinationDocumentId', 'matchType', 'action', 'reviewReason'], userMatching);
  writeCsv(outputDir + '/role-validation.csv', ['email', 'sourceRole', 'currentRole', 'finalRole', 'finalPermissionFlags', 'action'], roleValidation);
  writeCsv(outputDir + '/table-migration.csv', ['sourceTable', 'disposition', 'destination', 'sourceCount', 'currentCount', 'create', 'enrich', 'noOp', 'archive', 'limitation', 'review', 'exclude', 'expectedFinalCount'], tableMigrationRows);
  writeCsv(outputDir + '/id-mapping.csv', ['sourceSystem', 'sourceTable', 'sourceRecordId', 'sourceBusinessId', 'destinationCollection', 'destinationDocumentId', 'matchRule', 'action', 'sourceChecksum', 'runId', 'reviewReason'], ledgers);
  writeCsv(outputDir + '/relationship-reconciliation.csv', ['sourceTable', 'sourceRecordId', 'field', 'targetTable', 'targetSourceRecordId', 'targetDestinationDocumentId', 'status'], relationships);
  writeCsv(outputDir + '/field-conflicts.csv', ['sourceTable', 'sourceRecordId', 'destinationCollection', 'destinationDocumentId', 'field', 'currentValueHash', 'sourceValueHash', 'winner'], conflicts);
  writeCsv(outputDir + '/data-loss-risk.csv', ['severity', 'sourceTable', 'sourceRecordId', 'finding', 'treatment'], riskRows);
  writeJsonLines(outputDir + '/planned-writes.jsonl', [
    ...writes,
    {
      phase: 4,
      operation: 'create',
      collection: RUN_COLLECTION,
      documentId: runId,
      data: summary,
      precondition: { exists: false },
    },
  ]);
  writeJson(outputDir + '/reconciliation-summary.json', summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
