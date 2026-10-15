/** Shared by the API and Firestore write worker. Contains no browser credentials. */
import { isMeetingVisibleToViewer, normalizeMeetingDepartment } from './meetingAccess';

export type RealtimeRecordScope =
  | { kind: 'references'; fields: string[]; values: string[]; caseSensitive?: boolean; firstArrayValue?: boolean }
  | { kind: 'meetings'; department: 'PW' | 'FOLK'; all: boolean; identities: string[]; email: string };
export type QueryDependency = {
  table: string;
  query: { id?: string; filters?: Record<string, unknown>; fields?: string[]; sorts?: { field: string; dir: string }[] };
  scope?: RealtimeRecordScope;
};
export type RecordChange = {
  table: string;
  id: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  version: string;
};

export function stableValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** Lexicographically ordered Firestore timestamps, with nanosecond precision. */
export function firestoreVersion(timestamp: { seconds: number; nanoseconds: number }): string {
  return `${String(timestamp.seconds).padStart(12, '0')}.${String(timestamp.nanoseconds).padStart(9, '0')}`;
}

function valueAt(record: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((value, part) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, record);
}
const equal = (left: unknown, right: unknown) => stableValue(left) === stableValue(right);

function scopeMatches(scope: RealtimeRecordScope | undefined, record: Record<string, unknown>): boolean {
  if (!scope) return true;
  if (scope.kind === 'meetings') return normalizeMeetingDepartment(record.segment || 'PW') === scope.department &&
    (scope.all || isMeetingVisibleToViewer(record, { department: scope.department, canViewAllMeetings: false,
      isReadOnlySadhanaMentor: false, identityKeys: new Set(scope.identities), names: new Set<string>(), email: scope.email }));
  const normalize = (value: unknown) => scope.caseSensitive ? String(value || '').trim() : String(value || '').trim().toLowerCase();
  const allowed = new Set(scope.values.map(normalize));
  return scope.fields.some(field => {
    const raw = valueAt(record, field);
    const values = Array.isArray(raw) ? (scope.firstArrayValue ? raw.slice(0, 1) : raw) : [raw];
    return values.some(value => !!normalize(value) && allowed.has(normalize(value)));
  });
}

function matches(record: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([field, filter]) => {
    if (filter === undefined) return true;
    const actual = valueAt(record, field) as any;
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return equal(actual, filter);
    return Object.entries(filter).every(([op, expected]: [string, any]) => {
      switch (op) {
        case 'in': return Array.isArray(expected) && expected.slice(0, 30).some(item => equal(actual, item));
        case 'notIn': case 'not_in': return !Array.isArray(expected) || !expected.length ||
          (actual !== undefined && actual !== null && !expected.slice(0, 30).some(item => equal(actual, item)));
        case 'gte': return actual !== undefined && actual >= expected;
        case 'lte': return actual !== undefined && actual <= expected;
        case 'gt': return actual !== undefined && actual > expected;
        case 'lt': return actual !== undefined && actual < expected;
        case 'ne': case 'neq': return actual !== undefined && !equal(actual, expected);
        // The existing Table adapter ignores unknown operators. Do not make
        // the invalidator narrower than the actual database query.
        default: return true;
      }
    });
  });
}

export function dependencyAffected(dependency: QueryDependency, change: RecordChange): boolean {
  if (dependency.table !== change.table) return false;
  const { query } = dependency;
  const filters = query.id ? { id: query.id } : query.filters || {};
  const before = change.before ? { ...change.before, id: change.id } : undefined;
  const after = change.after ? { ...change.after, id: change.id } : undefined;
  const beforeMatches = !!before && matches(before, filters) && scopeMatches(dependency.scope, before);
  const afterMatches = !!after && matches(after, filters) && scopeMatches(dependency.scope, after);
  if (!beforeMatches && !afterMatches) return false;
  if (beforeMatches !== afterMatches || !before || !after) return true;
  if (!Array.isArray(query.fields)) return !equal(change.before, change.after);
  // Changes in ordering may change a limited/paginated result even when a
  // sort field wasn't projected. Filter fields likewise affect membership.
  const fields = new Set([...query.fields, ...Object.keys(filters), ...(query.sorts || []).map(sort => sort.field)]);
  return [...fields].some(field => !equal(valueAt(before, field), valueAt(after, field)));
}

const TOPIC_FIELDS = ['id', 'user', 'userId', 'group', 'groupId', 'guide', 'facilitator', 'facilitatorId', 'residency', 'segment', 'department'];
export function dependencyTopics(dependency: QueryDependency): string[] {
  const scope = dependency.scope;
  if (scope?.kind === 'references') {
    if (scope.fields.some(field => ![...TOPIC_FIELDS, 'memberId'].includes(field))) return [`${dependency.table}:*`];
    return scope.fields.flatMap(field => scope.values.map(value => `${dependency.table}:ref:${field}:${stableValue(String(value).trim().toLowerCase())}`));
  }
  const filters = dependency.query.id ? { id: dependency.query.id } : dependency.query.filters || {};
  for (const field of TOPIC_FIELDS) {
    const filter = filters[field];
    if (filter === undefined) continue;
    const values = filter && typeof filter === 'object' && !Array.isArray(filter)
      ? (filter as { in?: unknown[] }).in?.slice(0, 30) : [filter];
    if (values?.length) return values.map(value => `${dependency.table}:${field}:${stableValue(value)}`);
  }
  return [`${dependency.table}:*`];
}
export function changeTopics(change: RecordChange): string[] {
  const topics = new Set([`${change.table}:*`, `${change.table}:id:${stableValue(change.id)}`]);
  for (const record of [change.before, change.after]) {
    if (!record) continue;
    for (const field of TOPIC_FIELDS) {
      if (field !== 'id' && record[field] !== undefined) topics.add(`${change.table}:${field}:${stableValue(record[field])}`);
    }
    for (const field of [...TOPIC_FIELDS, 'memberId']) {
      const raw = field === 'id' ? change.id : record[field];
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (value) topics.add(`${change.table}:ref:${field}:${stableValue(String(value).trim().toLowerCase())}`);
      }
    }
  }
  return [...topics];
}
