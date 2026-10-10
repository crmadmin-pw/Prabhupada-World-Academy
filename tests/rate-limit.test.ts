import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import {
  consumeRateLimit,
  enforceRateLimit,
  RATE_LIMIT_MESSAGE,
  rateLimitMemorySize,
  sweepExpiredRateLimits,
} from '../src/utils/rateLimit';
import { caughtApiError, POST } from '../src/app/api/run/[endpoint]/route';

function sharedDatabase() {
  const documents = new Map<string, Record<string, unknown>>();
  let queue = Promise.resolve();
  let afterQuery: (() => void) | undefined;

  function database() {
    return {
      collection(name: string) {
        return {
          doc(id: string) {
            return { path: `${name}/${id}` };
          },
          where(field: string, _op: string, value: number) {
            return {
              limit(max: number) {
                return {
                  async get() {
                    const docs = [...documents.entries()]
                      .filter(([path, data]) => path.startsWith(`${name}/`) && Number(data[field]) < value)
                      .slice(0, max)
                      .map(([path, data]) => ({ ref: { path }, data: () => ({ ...data }) }));
                    afterQuery?.();
                    afterQuery = undefined;
                    return { docs };
                  },
                };
              },
            };
          },
        };
      },
      runTransaction(fn: (tx: {
        get: (ref: { path: string }) => Promise<{ data: () => Record<string, unknown> | undefined }>;
        set: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
        delete: (ref: { path: string }) => void;
      }) => Promise<unknown>) {
        const result = queue.then(() => fn({
          get: async (ref) => ({
            data: () => documents.get(ref.path) ? { ...documents.get(ref.path) } : undefined,
          }),
          set: (ref, data) => { documents.set(ref.path, { ...data }); },
          update: (ref, data) => { documents.set(ref.path, { ...documents.get(ref.path), ...data }); },
          delete: (ref) => { documents.delete(ref.path); },
        }));
        queue = result.then(() => undefined, () => undefined);
        return result;
      },
    };
  }

  return {
    serverA: database(),
    serverB: database(),
    documents,
    refreshAfterQuery(update: () => void) { afterQuery = update; },
  };
}

async function withNodeEnv<T>(value: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test('servers that share storage share one allowance', async () => {
  const { serverA, serverB } = sharedDatabase();
  const calls = [
    ...Array.from({ length: 3 }, () => consumeRateLimit('ip:203.0.113.5', 5, 60_000, { db: serverA, sweep: false })),
    ...Array.from({ length: 3 }, () => consumeRateLimit('ip:203.0.113.5', 5, 60_000, { db: serverB, sweep: false })),
  ];
  const limited = await Promise.all(calls);
  assert.equal(limited.filter(Boolean).length, 1);
});

test('a closed window starts over and the raw key is not stored', async () => {
  const { serverA, documents } = sharedDatabase();
  const key = 'token:super-secret-token-value';
  assert.equal(await consumeRateLimit(key, 1, 1_000, { db: serverA, now: 0, sweep: false }), false);
  assert.equal(await consumeRateLimit(key, 1, 1_000, { db: serverA, now: 500, sweep: false }), true);
  assert.equal(await consumeRateLimit(key, 1, 1_000, { db: serverA, now: 1_000, sweep: false }), false);

  assert.equal(documents.size, 1);
  const stored = [...documents.values()][0];
  assert.equal(stored.count, 1);
  assert.equal(stored.resetAt, 2_000);
  assert.equal((stored.expiresAt as Date).getTime(), 2_000);
  assert.equal(JSON.stringify([...documents.entries()]).includes('super-secret-token-value'), false);
});

test('cleanup removes closed windows and keeps a window that was refreshed', async () => {
  const store = sharedDatabase();
  await consumeRateLimit('stale', 5, 1_000, { db: store.serverA, now: 0, sweep: false });
  await consumeRateLimit('live', 5, 1_000, { db: store.serverA, now: 5_000, sweep: false });
  assert.equal(await sweepExpiredRateLimits(store.serverA, 5_000), 1);
  assert.equal(store.documents.size, 1);
  assert.equal([...store.documents.values()][0].resetAt, 6_000);

  await consumeRateLimit('raced', 5, 1_000, { db: store.serverA, now: 0, sweep: false });
  const raced = [...store.documents.keys()].find(path => store.documents.get(path)?.resetAt === 1_000);
  assert.ok(raced);
  store.refreshAfterQuery(() => {
    store.documents.set(raced, { count: 2, resetAt: 9_000, expiresAt: new Date(9_000) });
  });
  assert.equal(await sweepExpiredRateLimits(store.serverA, 5_000), 0);
  assert.equal(store.documents.get(raced)?.resetAt, 9_000);
});

test('enforceRateLimit reports the shared allowance as too many requests', async () => {
  const { serverA } = sharedDatabase();
  await enforceRateLimit('register:user', 1, 60_000, serverA);
  await assert.rejects(
    () => enforceRateLimit('register:user', 1, 60_000, serverA),
    (error: unknown) => {
      const failure = caughtApiError(error);
      assert.equal(failure.status, 429);
      assert.equal(failure.code, 'TOO_MANY_REQUESTS');
      assert.equal(failure.message, RATE_LIMIT_MESSAGE);
      assert.equal(failure.retryAfterSeconds, 60);
      return true;
    },
  );
});

test('a rate-limit error without a status code is still too many requests', () => {
  const failure = caughtApiError(new Error('Rate limit exceeded — please wait before retrying'));
  assert.equal(failure.status, 429);
  assert.equal(failure.message, RATE_LIMIT_MESSAGE);
  assert.equal(failure.code, 'TOO_MANY_REQUESTS');
});

test('the API returns 429 and a friendly message when the request allowance is used up', async () => {
  await withNodeEnv('test', async () => {
    const ip = '203.0.113.88';
    let response: Awaited<ReturnType<typeof POST>> | undefined;
    for (let attempt = 0; attempt < 61; attempt++) {
      response = await POST(new NextRequest('http://localhost/api/run/lookupPhone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ phone: '9876543210' }),
      }), { params: Promise.resolve({ endpoint: 'lookupPhone' }) });
    }
    assert.ok(response);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '60');
    assert.deepEqual(await response.json(), {
      message: RATE_LIMIT_MESSAGE,
      code: 'TOO_MANY_REQUESTS',
    });
  });
});

test('without shared storage, production denies and other environments drop closed windows', async () => {
  await withNodeEnv('production', async () => {
    assert.equal(await consumeRateLimit('ip:203.0.113.9', 10, 1_000, { db: null, now: 0, sweep: false }), true);
  });

  await withNodeEnv('test', async () => {
    await consumeRateLimit('expired-a', 3, 1_000, { db: null, now: 0, sweep: false });
    await consumeRateLimit('expired-b', 3, 1_000, { db: null, now: 0, sweep: false });
    await consumeRateLimit('current', 3, 1_000, { db: null, now: 1e15, sweep: false });
    assert.equal(rateLimitMemorySize(), 1);
  });
});
