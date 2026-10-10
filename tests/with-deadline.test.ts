import assert from 'node:assert/strict';
import test from 'node:test';
import { withDeadline } from '../src/lib/withDeadline';

test('a click stops waiting when the work never finishes', async () => {
  await assert.rejects(
    () => withDeadline(new Promise(() => {}), 30, 'too long'),
    /too long/,
  );
});

test('a click still receives a result that finishes in time', async () => {
  assert.equal(await withDeadline(Promise.resolve('saved'), 50), 'saved');
});
