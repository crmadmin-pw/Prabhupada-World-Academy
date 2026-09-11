import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_USER_NAMES_BY_EMAIL,
  NON_BLOCKING_MIGRATION_ASSERTIONS,
  PERMISSION_FIELDS,
  PROTECTED_USER_FIELDS,
  SOURCE_TABLES,
  assertStaticConfiguration,
} from '../scripts/zite-firestore-migration/config';
import { canonicalJson, normalizeEmail, sourceFieldToCamelCase } from '../scripts/zite-firestore-migration/common';
import { decodeFields, encodeFields, fieldPath } from '../scripts/zite-firestore-migration/firestoreRest';
import { validateZiteSchema } from '../scripts/zite-firestore-migration/schemaValidation';

test('migration table manifest is complete and prefix-excludes every LLP table', () => {
  assert.doesNotThrow(assertStaticConfiguration);
  assert.equal(SOURCE_TABLES.length, 62);
  assert.equal(SOURCE_TABLES.filter((table) => table.disposition === 'exclude').length, 13);
  assert.ok(SOURCE_TABLES.filter((table) => /^LLP/i.test(table.source)).every((table) => table.disposition === 'exclude'));
  assert.ok(SOURCE_TABLES.filter((table) => table.disposition === 'operational').every((table) => table.destination));
});

test('legacy push subscriptions are archive-only even though the current collection is inventoried', () => {
  const push = SOURCE_TABLES.find((table) => table.source === 'Push Subscriptions');
  assert.equal(push?.disposition, 'archive_only');
  assert.equal(push?.destination, 'PushSubscriptions');
});

test('user role and permission fields are protected', () => {
  assert.ok(PROTECTED_USER_FIELDS.has('role'));
  assert.ok(PROTECTED_USER_FIELDS.has('status'));
  assert.ok(PROTECTED_USER_FIELDS.has('segment'));
  for (const field of PERMISSION_FIELDS) assert.ok(PROTECTED_USER_FIELDS.has(field));
});

test('operator-confirmed user names are canonicalized by exact email', () => {
  assert.equal(CANONICAL_USER_NAMES_BY_EMAIL['arap@hkmmumbai.org'], 'Arjunacharya Das');
  assert.equal(CANONICAL_USER_NAMES_BY_EMAIL['vbmd@hkmmumbai.org'], 'Vaibhav Mohan Das');
});

test('soft-deleted records remain outside every operational table decision', () => {
  assert.ok(SOURCE_TABLES.every((table) => !String(table.disposition).includes('deleted')));
  assert.ok(NON_BLOCKING_MIGRATION_ASSERTIONS.has('allOperationalRelationshipsResolved'));
  assert.ok(NON_BLOCKING_MIGRATION_ASSERTIONS.has('tombstonesAvailable'));
});

test('normalization and field conversion are deterministic', () => {
  assert.equal(normalizeEmail('  Test.User@Example.COM '), 'test.user@example.com');
  assert.equal(sourceFieldToCamelCase('BVSL Preaching Entries'), 'bvslPreachingEntries');
  assert.equal(sourceFieldToCamelCase('NR Filling Same Day Points'), 'nrFillingSameDayPoints');
  assert.equal(sourceFieldToCamelCase('Field Values JSON'), 'fieldValuesJson');
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test('Firestore REST encoding preserves migration JSON values', () => {
  const value = { string: 'x', integer: 7, double: 1.25, bool: true, nil: null, list: ['a', 2], map: { nested: false } };
  assert.deepEqual(decodeFields(encodeFields(value)), value);
  assert.equal(fieldPath('simpleField'), 'simpleField');
  assert.equal(fieldPath('field.with.dot'), '`field.with.dot`');
});

test('schema validation rejects missing tables and orphaned links', () => {
  assert.deepEqual(validateZiteSchema([
    { name: 'Users', fields: [{ name: 'Guide', type: 'linked_record', linksTo: 'Guides' }] },
    { name: 'Guides', fields: [] },
  ], ['Users', 'Guides']), {
    tableCount: 2,
    configuredTableCount: 2,
    exactlyConfiguredTables: true,
    linkedRecordFieldCount: 1,
    orphanedLinkedRecordFields: [],
  });
  assert.throws(() => validateZiteSchema([{ name: 'Users', fields: [] }], ['Users', 'Guides']), /schema\/config mismatch/);
  assert.throws(() => validateZiteSchema([
    { name: 'Users', fields: [{ name: 'Guide', type: 'linked_record', linksTo: 'Missing' }] },
  ], ['Users']), /orphaned linked-record/);
});
