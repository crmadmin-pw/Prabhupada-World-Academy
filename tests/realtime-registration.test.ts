import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiUserContext } from '../src/lib/apiAuthorization';
import { REALTIME_CLOCKS, REALTIME_SUBSCRIPTIONS } from '../src/lib/realtimeCollections';
import { registerRealtimeQuery, scheduleRealtimeQuery } from '../src/lib/realtimeQueryRegistration';
import type { QueryDependency } from '../src/lib/realtimeQueryModel';

const user = (id: string) => ({ uid: id, id }) as ApiUserContext;
const dependency: QueryDependency = { table: 'Meetings', query: { filters: { segment: 'PW' }, fields: ['title'] } };
const version = (n: number) => `${String(n).padStart(12, '0')}.000000000`;

function registrationDatabase(clocks: Record<string, string> = {}) {
  const docs = new Map<string, Record<string, unknown>>();
  for (const [table, clock] of Object.entries(clocks)) docs.set(`${REALTIME_CLOCKS}/${table}`, { version: clock });
  let transactions = 0;
  function node(path: string): { path: string; collection: (name: string) => { doc: (id: string) => ReturnType<typeof node> } } {
    return {
      path,
      collection(name: string) {
        return { doc: (id: string) => node(`${path}/${name}/${id}`) };
      },
    };
  }
  return {
    get transactions() { return transactions; },
    read(path: string) { return docs.get(path); },
    collection(name: string) {
      return { doc: (id: string) => node(`${name}/${id}`) };
    },
    async runTransaction(fn: (tx: {
      getAll: (...refs: { path: string }[]) => Promise<Array<{ exists: boolean; data: () => Record<string, unknown> | undefined }>>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<void>) {
      transactions += 1;
      const writes: [string, Record<string, unknown>][] = [];
      await fn({
        async getAll(...refs) {
          return refs.map(ref => ({
            exists: docs.has(ref.path),
            data: () => docs.get(ref.path) ? { ...docs.get(ref.path)! } : undefined,
          }));
        },
        set(ref, data) { writes.push([ref.path, { ...data }]); },
      });
      for (const [path, data] of writes) docs.set(path, data);
    },
  };
}

test('a burst of the same query shares one registration transaction', async () => {
  const db = registrationDatabase();
  const caller = user('burst');
  const registrations = await Promise.all(Array.from({ length: 5 }, () =>
    registerRealtimeQuery(caller, 'getMeetings', { department: 'PW' }, [dependency], version(1), db)));
  assert.equal(db.transactions, 1);
  assert.equal(new Set(registrations.map(registration => registration?.token)).size, 1);
  assert.ok(db.read(`${REALTIME_SUBSCRIPTIONS}/${registrations[0]?.token}`));
});

test('the response token is ready before the registration transaction', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const db = registrationDatabase();
  const run = db.runTransaction.bind(db);
  db.runTransaction = fn => gate.then(() => run(fn));
  try {
    const receipt = scheduleRealtimeQuery(user('scheduled'), 'getMeetings', { department: 'PW' }, [dependency], version(4), db);
    assert.equal(db.transactions, 0);
    assert.equal(receipt?.version, version(4));
    assert.equal(receipt?.token.length, 64);
  } finally {
    release();
  }
});

test('an earlier read still observes a clock that moved before registration', async () => {
  const db = registrationDatabase({ Meetings: version(5), Users: version(5) });
  const caller = user('clock');
  const [earlier, later] = await Promise.all([
    registerRealtimeQuery(caller, 'getMeetings', { department: 'PW' }, [dependency], version(2), db),
    registerRealtimeQuery(caller, 'getMeetings', { department: 'PW' }, [dependency], version(4), db),
  ]);
  assert.equal(db.transactions, 1);
  assert.equal(earlier?.version, version(2));
  assert.equal(later?.version, version(4));
  const stored = db.read(`${REALTIME_SUBSCRIPTIONS}/${earlier?.token}`);
  const signal = db.read(`RealtimeClients/${caller.uid}/queries/${earlier?.token}`);
  assert.equal(stored?.readVersion, version(2));
  assert.equal(signal?.version, version(5));
});

test('a different query is not coalesced, and a failed registration rejects only its waiter', async () => {
  const db = registrationDatabase();
  const caller = user('split');
  const [first, second] = await Promise.all([
    registerRealtimeQuery(caller, 'getMeetings', { department: 'PW' }, [dependency], version(1), db),
    registerRealtimeQuery(caller, 'getGuideUsers', { status: 'Active' }, [dependency], version(1), db),
  ]);
  assert.equal(db.transactions, 2);
  assert.notEqual(first?.token, second?.token);

  const failing = registrationDatabase();
  failing.runTransaction = async () => { throw new Error('unavailable'); };
  const failedCaller = user('failed');
  const receipt = scheduleRealtimeQuery(failedCaller, 'getMeetings', { department: 'FOLK' }, [dependency], version(1), failing);
  assert.ok(receipt?.token);
  await assert.rejects(
    () => registerRealtimeQuery(failedCaller, 'getMeetings', { department: 'FOLK' }, [dependency], version(1), failing),
    /unavailable/,
  );
});
