/* eslint-disable @typescript-eslint/no-explicit-any -- verifier reads heterogeneous external snapshot JSON */
import path from 'node:path';
import {
  ARCHIVE_COLLECTION,
  LEDGER_COLLECTION,
  NON_BLOCKING_MIGRATION_ASSERTIONS,
  PERMISSION_FIELDS,
  PROTECTED_USER_FIELDS,
  SOURCE_TABLES,
  assertStaticConfiguration,
} from './config';
import { canonicalJson, isBlank, readJson, readJsonLines, sha256, writeJson } from './common';

function main(): void {
  assertStaticConfiguration();
  const runDirArg = process.argv[2];
  if (!runDirArg) throw new Error('Usage: node --import tsx verifyDryRun.ts <run-directory>');
  const runDir = path.resolve(runDirArg);
  const dryRunDir = path.join(runDir, 'dry-run');
  const summary = readJson<any>(path.join(dryRunDir, 'reconciliation-summary.json'));
  const writes = readJsonLines(path.join(dryRunDir, 'planned-writes.jsonl'));
  const roleManifest = readJson<any>(path.join(dryRunDir, 'approved-role-map.json'));
  const firestoreManifest = readJson<any>(path.join(runDir, 'firestore', 'manifest.json'));
  const ziteManifest = readJson<any>(path.join(runDir, 'zite', 'manifest.json'));

  const current = new Map<string, any>();
  for (const table of firestoreManifest.tables) {
    for (const row of readJsonLines(path.join(runDir, 'firestore', table.file))) {
      current.set(`${table.collection}|${row.id}`, row);
    }
  }

  const sourceRows = new Map<string, any>();
  for (const table of ziteManifest.tables.filter((entry: any) => entry.file)) {
    for (const row of readJsonLines(path.join(runDir, 'zite', table.file))) {
      sourceRows.set(`${table.source}|${row.id}`, row);
    }
  }

  const duplicateTargets = new Set<string>();
  const seenTargets = new Set<string>();
  for (const write of writes) {
    const key = `${write.collection}|${write.documentId}`;
    if (seenTargets.has(key)) duplicateTargets.add(key);
    seenTargets.add(key);
  }

  const operationalWrites = writes.filter((write) => write.phase === 3);
  const sourcePushRows = [...sourceRows]
    .filter(([key]) => key.startsWith('Push Subscriptions|'))
    .map(([, row]) => row);
  const legacyCredentialValues = new Set<string>();
  for (const row of sourcePushRows) {
    for (const [field, value] of Object.entries(row)) {
      if (!/(endpoint|token|p256dh|auth|subscription id|device)/i.test(field)) continue;
      if (typeof value === 'string' && value.length >= 8) legacyCredentialValues.add(value);
    }
  }
  const operationalJson = canonicalJson(operationalWrites);
  const leakedLegacyValues = [...legacyCredentialValues].filter((value) => operationalJson.includes(value));

  const overwriteViolations: string[] = [];
  for (const write of operationalWrites.filter((entry) => entry.operation === 'update')) {
    const existing = current.get(`${write.collection}|${write.documentId}`);
    if (!existing) {
      overwriteViolations.push(`${write.collection}/${write.documentId}:missing-current-precondition-target`);
      continue;
    }
    for (const key of Object.keys(write.data)) {
      if (!isBlank(existing.data[key])) overwriteViolations.push(`${write.collection}/${write.documentId}:${key}`);
    }
  }

  const createdUserPrivilegeViolations: string[] = [];
  const matchedUserPrivilegeViolations: string[] = [];
  for (const write of operationalWrites.filter((entry) => entry.collection === 'Users')) {
    if (write.operation === 'create') {
      if (write.data.role !== 'User' || PERMISSION_FIELDS.some((field) => write.data[field] !== false)) {
        createdUserPrivilegeViolations.push(write.documentId);
      }
    } else if ([...PROTECTED_USER_FIELDS].some((field) => field in write.data)) {
      matchedUserPrivilegeViolations.push(write.documentId);
    }
  }

  const sourceKeys = [...sourceRows.keys()];
  const archiveSources = new Set(
    writes.filter((write) => write.collection === ARCHIVE_COLLECTION).map((write) => `${write.sourceTable}|${write.sourceRecordId}`),
  );
  const ledgerSources = new Set(
    writes.filter((write) => write.collection === LEDGER_COLLECTION).map((write) => `${write.sourceTable}|${write.sourceRecordId}`),
  );
  const maxPlannedDocumentBytes = Math.max(...writes.map((write) => Buffer.byteLength(canonicalJson(write.data), 'utf8')), 0);

  const checks = {
    exactly62TableDecisions: SOURCE_TABLES.length === 62,
    noLlpSourceRows: sourceKeys.every((key) => !/^LLP/i.test(key)),
    noLlpWrites: writes.every((write) => !/^LLP/i.test(write.sourceTable ?? '')),
    noDeleteOperations: writes.every((write) => write.operation === 'create' || write.operation === 'update'),
    noDuplicateWriteTargets: duplicateTargets.size === 0,
    allUpdatesHaveUpdateTimePreconditions: writes
      .filter((write) => write.operation === 'update')
      .every((write) => typeof write.precondition?.updateTime === 'string'),
    allCreatesRequireAbsence: writes
      .filter((write) => write.operation === 'create')
      .every((write) => write.precondition?.exists === false),
    currentNonemptyFieldsNeverOverwritten: overwriteViolations.length === 0,
    allSourceRowsArchived: sourceKeys.every((key) => archiveSources.has(key)),
    allSourceRowsHaveLedger: sourceKeys.every((key) => ledgerSources.has(key)),
    noLegacyPushOperationalWrites: operationalWrites.every((write) => !(write.collection === 'PushSubscriptions' && write.sourceTable === 'Push Subscriptions')),
    noLegacyCredentialValueLeak: leakedLegacyValues.length === 0,
    ziteOnlyUsersUnprivileged: createdUserPrivilegeViolations.length === 0,
    matchedUsersProtected: matchedUserPrivilegeViolations.length === 0,
    roleManifestChecksumValid: roleManifest.checksum === sha256(canonicalJson(roleManifest.users)),
    summaryWriteCountMatches: summary.plannedWrites === writes.length,
    firestoreDocumentLimitGuard: maxPlannedDocumentBytes < 900_000,
    approvalGateCalculationValid: summary.approvalReady === Object.entries(summary.assertions)
      .filter(([name]) => !NON_BLOCKING_MIGRATION_ASSERTIONS.has(name))
      .every(([, passed]) => passed === true),
    softDeleteLimitationIsArchiveOnly: summary.limitations?.softDeletedRecordsUnavailable === true &&
      summary.limitations?.softDeletedRecordsOperationallyRestored === false &&
      summary.limitations?.futurePitrExportSupported === true,
  };
  const verification = {
    kind: 'migration-dry-run-verification',
    runId: summary.runId,
    verifiedAt: new Date().toISOString(),
    planValid: Object.values(checks).every(Boolean),
    approvalReady: summary.approvalReady === true,
    checks,
    evidence: {
      sourceRows: sourceKeys.length,
      plannedWrites: writes.length,
      operationalWrites: operationalWrites.length,
      sourcePushRows: sourcePushRows.length,
      legacyCredentialValuesChecked: legacyCredentialValues.size,
      maxPlannedDocumentBytes,
      duplicateTargets: [...duplicateTargets],
      overwriteViolations: overwriteViolations.slice(0, 20),
      leakedLegacyValuesCount: leakedLegacyValues.length,
      createdUserPrivilegeViolations,
      matchedUserPrivilegeViolations,
    },
  };
  writeJson(path.join(dryRunDir, 'verification.json'), verification);
  process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  if (!verification.planValid) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
