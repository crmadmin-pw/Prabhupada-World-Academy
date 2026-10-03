import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeTopics, dependencyAffected, dependencyTopics, firestoreVersion, type QueryDependency, type RecordChange } from '../src/lib/realtimeQueryModel';
import { recordQueryReadTime, requestQuery, scopeRealtimeDependencies, withRequestQueries } from '../src/lib/requestQueries';

const dependency: QueryDependency = { table: 'SadhanaEntries', query: {
  filters: { user: { in: ['member-a', 'legacy-a'] }, date: { gte: '2026-09-01', lte: '2026-09-09' } },
  fields: ['user', 'date', 'rounds'],
} };
const change = (after: Record<string, unknown>, before?: Record<string, unknown>): RecordChange =>
  ({ table: 'SadhanaEntries', id: 'entry-a', version: '000000000100.000000000', before, after });

test('matches only the assigned member and selected date range, including legacy aliases', () => {
  assert.equal(dependencyAffected(dependency, change({ user: 'member-a', date: '2026-09-09' })), true);
  assert.equal(dependencyAffected(dependency, change({ user: 'legacy-a', date: '2026-09-01' })), true);
  assert.equal(dependencyAffected(dependency, change({ user: 'member-b', date: '2026-09-09' })), false);
  assert.equal(dependencyAffected(dependency, change({ user: 'member-a', date: '2026-08-31' })), false);
  assert.equal(dependencyAffected(dependency, change({ user: 'member-a', date: '2026-09-10' })), false);
});

test('creates, deletes and moves invalidate both previous and new result scopes', () => {
  const before = { user: 'member-a', date: '2026-09-09' };
  const after = { user: 'member-b', date: '2026-09-09' };
  assert.equal(dependencyAffected(dependency, change(after, before)), true);
  assert.equal(dependencyAffected(dependency, { ...change(before), before, after: undefined }), true);
  assert.equal(dependencyAffected(dependency, change(before, after)), true);
});

test('unrelated tables and unprojected bookkeeping changes do not invalidate a report', () => {
  const before = { user: 'member-a', date: '2026-09-09', rounds: 16, touchedAt: 1 };
  assert.equal(dependencyAffected(dependency, change({ ...before, touchedAt: 2 }, before)), false);
  assert.equal(dependencyAffected(dependency, change({ ...before, rounds: 12 }, before)), true);
  assert.equal(dependencyAffected(dependency, { ...change(before), table: 'Meetings' }), false);
});

test('a new pending registration invalidates the open approvals read', () => {
  const approvals = { table: 'Users', query: { fields: ['id', 'fullName', 'status', 'segment', 'isPrabhupadaWorldUser'] } };
  const registration = {
    table: 'Users', id: 'new-devotee', version: '000000000200.000000000',
    after: { fullName: 'New Devotee', status: 'Pending Approval', segment: 'PW', isPrabhupadaWorldUser: true },
  };
  assert.equal(dependencyAffected(approvals, registration), true);
  assert.ok(dependencyTopics(approvals).some(topic => changeTopics(registration).includes(topic)));
});

test('ordering changes invalidate a limited result even when not projected', () => {
  const dep = { table: 'Users', query: { fields: ['fullName'], sorts: [{ field: 'score', dir: 'desc' }] } };
  assert.equal(dependencyAffected(dep, { table: 'Users', id: 'u', version: '1', before: { fullName: 'A', score: 1 }, after: { fullName: 'A', score: 2 } }), true);
});

test('selective routing never excludes a matching query', () => {
  for (const user of ['member-a', 'legacy-a']) {
    const event = change({ user, date: '2026-09-09' });
    assert.ok(dependencyTopics(dependency).some(topic => changeTopics(event).includes(topic)));
  }
  assert.deepEqual(dependencyTopics({ table: 'Users', query: {} }), ['Users:*']);
});

test('nanosecond revision ordering is preserved', () => {
  assert.ok(firestoreVersion({ seconds: 100, nanoseconds: 1 }) < firestoreVersion({ seconds: 100, nanoseconds: 2 }));
  assert.ok(firestoreVersion({ seconds: 99, nanoseconds: 999999999 }) < firestoreVersion({ seconds: 100, nanoseconds: 0 }));
});

test('post-query report scopes suppress unrelated members and preserve old and new aliases', () => {
  const dep: QueryDependency = { table: 'SadhanaEntries', query: { filters: { date: '2026-09-09' } },
    scope: { kind: 'references', fields: ['user'], values: ['Member-A', 'legacy-a'], caseSensitive: true, firstArrayValue: true } };
  for (const user of ['Member-A', ['Member-A'], 'legacy-a']) {
    const event = change({ user, date: '2026-09-09' });
    assert.equal(dependencyAffected(dep, event), true);
    assert.ok(dependencyTopics(dep).some(topic => changeTopics(event).includes(topic)));
  }
  assert.equal(dependencyAffected(dep, change({ user: 'member-a', date: '2026-09-09' })), false);
  assert.equal(dependencyAffected(dep, change({ user: ['unrelated', 'Member-A'], date: '2026-09-09' })), false);
  assert.equal(dependencyAffected(dep, change({ user: 'unrelated', date: '2026-09-09' }, { user: 'Member-A', date: '2026-09-09' })), true);
});

test('meeting revisions stay within department and invitation scope, including invitation removal', () => {
  const dep: QueryDependency = { table: 'Meetings', query: {}, scope: {
    kind: 'meetings', department: 'PW', all: false, identities: ['member-a'], email: 'a@example.invalid',
  } };
  const event = (after: any, before?: any): RecordChange => ({ table: 'Meetings', id: 'm', version: '1', before, after });
  const invited = { segment: 'PW', inviteeUserIds: ['Member-A'] };
  assert.equal(dependencyAffected(dep, event(invited)), true);
  assert.equal(dependencyAffected(dep, event({ segment: 'FOLK', inviteeUserIds: ['member-a'] })), false);
  assert.equal(dependencyAffected(dep, event({ segment: 'PW', inviteeUserIds: ['member-b'] })), false);
  assert.equal(dependencyAffected(dep, event({ segment: 'PW', inviteeUserIds: [] }, invited)), true);
});

test('final endpoint scope refines captured reads without changing business results', async () => {
  const result = await withRequestQueries(async () => {
    const rows = await requestQuery('SadhanaEntries', 'findAll', {}, async () => ({ records: [{ user: 'a' }, { user: 'b' }] }));
    scopeRealtimeDependencies('SadhanaEntries', { kind: 'references', fields: ['user'], values: ['a'] });
    return rows.records.filter(row => row.user === 'a');
  }, true);
  assert.deepEqual(result.result, [{ user: 'a' }]);
  assert.equal(dependencyAffected(result.dependencies[0], change({ user: 'b' })), false);
});

test('authorized request capture deduplicates reads and keeps the earliest watermark', async () => {
  let calls = 0;
  const read = () => requestQuery('Users', 'findAll', { filters: { guide: 'a' } }, async () => {
    calls++;
    recordQueryReadTime({ seconds: 100, nanoseconds: 20 });
    return { records: [{ id: 'a' }] };
  });
  const result = await withRequestQueries(async () => {
    const records = await Promise.all([read(), read()]);
    recordQueryReadTime({ seconds: 101, nanoseconds: 0 });
    return records;
  }, true);
  assert.equal(calls, 1);
  assert.equal(result.dependencies.length, 1);
  assert.equal(result.metrics.deduplicated, 1);
  assert.equal(result.readVersion, firestoreVersion({ seconds: 100, nanoseconds: 20 }));
  assert.notEqual(result.result[0], result.result[1]);
});
