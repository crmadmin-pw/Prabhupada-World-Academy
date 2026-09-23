import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import { SOURCE_TABLES } from '../scripts/zite-firestore-migration/config';
import { readJson, safeFileName, writeJson, writeJsonLines } from '../scripts/zite-firestore-migration/common';

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zite-catchup-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configs = SOURCE_TABLES.filter(table => table.disposition !== 'exclude');
  writeJson(path.join(root, 'zite/capture-start.json'), { startedAt: '2026-09-23T05:59:33Z' });
  writeJson(path.join(root, 'zite/page-index.json'), {
    completedAt: '2026-09-23T06:07:56Z',
    tables: configs.map(table => ({ name: table.source, page: 1, count: 0 })),
  });
  for (const table of configs) writeJsonLines(path.join(root, `zite/pages/${safeFileName(table.source)}-0000.jsonl`), []);
  writeJson(path.join(root, 'firestore/manifest.json'), { capturedAt: '2026-09-23T06:02:58Z', tables: [{ collection: 'Users', count: 0 }] });
  writeJsonLines(path.join(root, 'firestore/tables/Users.jsonl'), []);
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/zite-firestore-migration/finalizeCatchupCapture.ts', root], { encoding: 'utf8' });
}

test('catch-up capture preserves exclusions and records that an active source is not a point-in-time snapshot', t => {
  const root = fixture(t);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const manifest = readJson(path.join(root, 'zite/manifest.json'));
  assert.equal(manifest.tables.length, 49);
  assert.equal(manifest.excludedTables.length, 13);
  assert.equal(manifest.consistentPointInTimeSnapshot, false);
  assert.equal(manifest.replayFrom, '2026-09-23T05:59:33Z');
  assert.equal(manifest.tables.find((row: { source: string }) => row.source === 'Push Subscriptions').disposition, 'archive_only');
  assert.equal(readJson(path.join(root, 'catchup-review.json')).productionImportApplied, false);
  assert.notEqual(run(root).status, 0, 'finalized captures must not be overwritten');
});

test('catch-up capture rejects incomplete source pagination', t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, 'zite/pages/Users-0000.jsonl'));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing export page/);
});

test('catch-up capture rejects duplicate record IDs', t => {
  const root = fixture(t);
  writeJsonLines(path.join(root, 'zite/pages/Users-0000.jsonl'), [{ id: 'same' }, { id: 'same' }]);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Duplicate, missing, or unordered ID/);
});

test('catch-up capture rejects an LLP table added to the export index', t => {
  const root = fixture(t);
  const index = readJson(path.join(root, 'zite/page-index.json'));
  index.tables.push({ name: 'LLP Users', page: 1, count: 0 });
  writeJson(path.join(root, 'zite/page-index.json'), index);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly the approved non-LLP tables/);
});

test('catch-up review reports cross-person USER number collisions and real access-status conflicts without merging', t => {
  const root = fixture(t);
  const index = readJson(path.join(root, 'zite/page-index.json'));
  index.tables.find((row: { name: string }) => row.name === 'Users').count = 3;
  writeJson(path.join(root, 'zite/page-index.json'), index);
  writeJsonLines(path.join(root, 'zite/pages/Users-0000.jsonl'), [
    { id: 'a', Email: 'incoming@example.com', 'Full Name': 'Incoming', 'User ID': 'USER-215', Status: 'Active' },
    { id: 'b', Email: '  GUIDE@example.com ', 'User ID': 'USER-150', Status: 'Inactive' },
    { id: 'c', Email: 'bare@example.com', Status: null },
  ]);
  writeJsonLines(path.join(root, 'firestore/tables/Users.jsonl'), [
    { id: 'existing', data: { email: 'different@example.com', userId: 'USER-215', fullName: 'Existing' } },
    { id: 'guide', data: { email: 'guide@example.com', userId: 'USER-150', status: 'Active' } },
    { id: 'bare', data: { email: 'bare@example.com' } },
  ]);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  const report = readJson(path.join(root, 'catchup-review.json'));
  assert.equal(report.userNumberCollisions.length, 1);
  assert.equal(report.userNumberCollisions[0].currentDocumentId, 'existing');
  assert.equal(report.userStatusConflicts.length, 1, 'null and missing status are semantically equal');
  assert.equal(report.userStatusConflicts[0].currentDocumentId, 'guide');
  assert.equal(report.sourceUsersWithoutUniqueExactEmailMatch.length, 1);
});
