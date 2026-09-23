/* eslint-disable @typescript-eslint/no-explicit-any -- external migration snapshot data */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_BASE_ID, SOURCE_SYSTEM, SOURCE_TABLES } from './config';
import { canonicalJson, normalizeEmail, readJson, readJsonLines, safeFileName, sha256, writeCsv, writeJson, writeJsonLines } from './common';

// Offline only: combines already-exported pages and records unresolved decisions.
// Does not connect to or modify either database.
const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: finalizeCatchupCapture.ts <run-dir>');
const sourceRoot = path.join(root, 'zite');
if (fs.existsSync(path.join(sourceRoot, 'manifest.json'))) throw new Error('Refusing to overwrite a finalized capture');
const index = readJson<any>(path.join(sourceRoot, 'page-index.json'));
const start = readJson<any>(path.join(sourceRoot, 'capture-start.json'));
const configs = SOURCE_TABLES.filter(t => t.disposition !== 'exclude');
const expectedNames = configs.map(t => t.source).sort();
if (canonicalJson(index.tables.map((t: any) => t.name).sort()) !== canonicalJson(expectedNames)) {
  throw new Error('Page index does not contain exactly the approved non-LLP tables');
}
const sourceRows = new Map<string, any[]>();
const tables = configs.map(config => {
  if (/^LLP/i.test(config.source)) throw new Error('LLP firewall violation');
  const table = index.tables.find((t: any) => t.name === config.source);
  const rows: any[] = [];
  let previousId = '';
  for (let page = 0; page < table.page; page++) {
    const file = path.join(sourceRoot, 'pages', `${safeFileName(table.name)}-${String(page).padStart(4, '0')}.jsonl`);
    if (!fs.existsSync(file)) throw new Error(`Missing export page: ${file}`);
    const batch = readJsonLines(file);
    if (batch.length > 1000 || (page < table.page - 1 && batch.length !== 1000) || (page === table.page - 1 && batch.length === 1000)) {
      throw new Error(`Incomplete or invalid pagination: ${file}`);
    }
    for (const row of batch) {
      if (typeof row.id !== 'string' || !row.id || row.id <= previousId) throw new Error(`Duplicate, missing, or unordered ID: ${file}`);
      previousId = row.id;
      rows.push(row);
    }
  }
  if (rows.length !== table.count) throw new Error(`Page count mismatch: ${table.name}`);
  sourceRows.set(config.source, rows);
  const file = `tables/${safeFileName(config.source)}.jsonl`;
  writeJsonLines(path.join(sourceRoot, file), rows);
  return {
    source: config.source, disposition: config.disposition, file,
    count: rows.length, checksum: sha256(fs.readFileSync(path.join(sourceRoot, file))),
    maxUpdatedAt: rows.map(row => row.updated_at).filter(Boolean).sort().at(-1) ?? null,
  };
});
const manifest = {
  kind: 'zite-catchup-capture', sourceSystem: SOURCE_SYSTEM, baseId: SOURCE_BASE_ID,
  captureStartedAt: start.startedAt, capturedAt: index.completedAt,
  replayFrom: start.replayFrom ?? start.startedAt,
  consistentPointInTimeSnapshot: false, sourceContinuesAcceptingWrites: true,
  visibleRowsOnly: true, tombstonesIncluded: false, attachmentBytesVerified: false,
  readOnly: true, excludedTables: SOURCE_TABLES.filter(t => t.disposition === 'exclude').map(t => t.source),
  tables,
};
writeJson(path.join(sourceRoot, 'manifest.json'), { ...manifest, checksum: sha256(canonicalJson(manifest)) });

const destinationManifest = readJson<any>(path.join(root, 'firestore/manifest.json'));
const currentUsers = readJsonLines(path.join(root, 'firestore/tables/Users.jsonl'));
const collisions: any[] = [];
const statusConflicts: any[] = [];
const unmatched: any[] = [];
for (const user of sourceRows.get('Users') ?? []) {
  const email = normalizeEmail(user.Email);
  const matches = email ? currentUsers.filter(row => normalizeEmail(row.data.email) === email) : [];
  const basic = { sourceId: user.id, name: user['Full Name'], email, ziteUserId: user['User ID'] ?? null };
  if (matches.length === 1) {
    const current = matches[0];
    if ((user.Status ?? null) !== (current.data.status ?? null)) statusConflicts.push({
      ...basic, currentDocumentId: current.id, ziteStatus: user.Status ?? null, currentStatus: current.data.status ?? null,
    });
  } else {
    unmatched.push({ ...basic, emailMatches: matches.length, ziteStatus: user.Status ?? null, ziteRole: user.Role ?? null });
    for (const current of currentUsers.filter(row => user['User ID'] && row.data.userId === user['User ID'])) {
      collisions.push({ ...basic, currentDocumentId: current.id, currentName: current.data.fullName, currentEmail: current.data.email, currentSegment: current.data.segment });
    }
  }
}
const baselineWatermark = '2026-09-11T00:54:54Z';
const counts = configs.map(config => {
  const rows = sourceRows.get(config.source) ?? [];
  const current = destinationManifest.tables.find((t: any) => t.collection === config.destination);
  return {
    table: config.source, disposition: config.disposition, ziteVisibleRowsCaptured: rows.length,
    currentWebsiteCollection: config.destination ?? null, currentWebsiteRowsCaptured: current?.count ?? null,
    sourceCreatedSinceBaseline: rows.filter(row => row.created_at > baselineWatermark).length,
    olderSourceRowsUpdatedSinceBaseline: rows.filter(row => row.created_at <= baselineWatermark && row.updated_at > baselineWatermark).length,
  };
});
const report = {
  kind: 'catchup-decision-preflight', generatedAt: new Date().toISOString(), productionImportApplied: false,
  baselineWatermark, captureStartedAt: manifest.captureStartedAt, captureEndedAt: manifest.capturedAt,
  consistentPointInTimeSnapshot: false, replayFrom: manifest.replayFrom,
  sourceRowTotal: tables.reduce((n, t) => n + t.count, 0), sourceTableCount: tables.length,
  currentSnapshotCompletedAt: destinationManifest.capturedAt,
  currentMigrationCollectionDocuments: destinationManifest.tables.reduce((n: number, t: any) => n + t.count, 0),
  counts, userNumberCollisions: collisions, userStatusConflicts: statusConflicts, sourceUsersWithoutUniqueExactEmailMatch: unmatched,
};
writeJson(path.join(root, 'catchup-review.json'), report);
writeCsv(path.join(root, 'table-counts.csv'), Object.keys(counts[0]), counts);
writeCsv(path.join(root, 'user-number-collisions.csv'), ['sourceId','name','email','ziteUserId','currentDocumentId','currentName','currentEmail','currentSegment'], collisions);
writeCsv(path.join(root, 'user-status-conflicts.csv'), ['sourceId','name','email','currentDocumentId','ziteStatus','currentStatus'], statusConflicts);
console.log(JSON.stringify({ sourceTableCount: report.sourceTableCount, sourceRowTotal: report.sourceRowTotal, userNumberCollisions: collisions.length, userStatusConflicts: statusConflicts.length, sourceUsersWithoutUniqueExactEmailMatch: unmatched.length, productionImportApplied: false }));
