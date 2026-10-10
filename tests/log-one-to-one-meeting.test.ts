import assert from 'node:assert/strict';
import test from 'node:test';

import logOneToOneMeeting from '../src/api/logOneToOneMeeting';
import { setFirestoreForTests } from '../src/lib/app-backend-sdk';

const indexError = Object.assign(
  new Error('9 FAILED_PRECONDITION: The query requires an index.'),
  { code: 9 },
);

const docs = new Map<string, Record<string, unknown>>();

function collection() {
  const filters: { field: string; op: string; value: unknown }[] = [];
  const query = {
    where(field: string, op: string, value: unknown) {
      filters.push({ field, op, value });
      return query;
    },
    orderBy() { return query; },
    select() { return query; },
    limit() { return query; },
    offset() { return query; },
    async get() {
      if (filters.length > 1) throw indexError;
      const readTime = { seconds: 1, nanoseconds: 0 };
      const matched = [...docs.entries()].filter(([, data]) => {
        if (filters.length === 0) return true;
        const { field, op, value } = filters[0];
        const actual = data[field];
        if (op === '==') return actual === value;
        if (op === 'array-contains') return Array.isArray(actual) && actual.includes(value);
        return false;
      }).map(([id, data]) => ({ id, data: () => data }));
      return { empty: matched.length === 0, docs: matched, readTime };
    },
    doc(id: string) {
      return {
        async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
          const next = options?.merge ? { ...(docs.get(id) || {}), ...data } : data;
          docs.set(id, next);
        },
      };
    },
  };
  return query;
}

const caller = {
  id: 'guide-1',
  role: 'SUPERVISOR',
  isBvSupervisor: true,
  segment: 'PW',
  email: 'supervisor@example.invalid',
};

test.before(() => {
  docs.clear();
  setFirestoreForTests({ collection });
});

test.after(() => setFirestoreForTests(undefined));

test('logging a call does not use the unindexed guide-member-week query', async () => {
  const input = {
    memberId: 'member-richa',
    weekDate: '2026-10-05',
    meetingDate: '2026-10-06',
    durationMinutes: 30,
    notes: 'sadhana',
    callStatus: 'Connected' as const,
    recordingLink: 'https://docs.google.com/document/d/example',
    nextCallDate: '2026-10-20',
    nextCallAgenda: 'telecalling script',
  };

  const created = await logOneToOneMeeting.execute({
    input,
    context: { user: caller },
  } as never);

  assert.equal(created.created, true);
  assert.equal(docs.size, 1);
  const stored = [...docs.values()][0];
  assert.equal(stored.member, 'member-richa');
  assert.equal(stored.guide, 'guide-1');
  assert.equal(stored.notes, 'sadhana');
  assert.equal(stored.durationMinutes, 30);

  const updated = await logOneToOneMeeting.execute({
    input: { ...input, notes: 'updated notes', durationMinutes: 45 },
    context: { user: caller },
  } as never);

  assert.equal(updated.created, false);
  assert.equal(updated.id, created.id);
  assert.equal(docs.size, 1);
  assert.equal([...docs.values()][0].notes, 'updated notes');
  assert.equal([...docs.values()][0].durationMinutes, 45);
});

test('an existing linked-record meeting for the same week is updated', async () => {
  docs.clear();
  docs.set('legacy-meeting', {
    id: 'legacy-meeting',
    guide: ['guide-1'],
    member: ['member-richa'],
    weekDate: '2026-10-05T00:00:00.000Z',
    notes: 'old',
  });

  const result = await logOneToOneMeeting.execute({
    input: {
      memberId: 'member-richa',
      weekDate: '2026-10-05',
      meetingDate: '2026-10-06',
      durationMinutes: 30,
      notes: 'replaced',
      callStatus: 'Connected' as const,
    },
    context: { user: caller },
  } as never);

  assert.equal(result.created, false);
  assert.equal(result.id, 'legacy-meeting');
  assert.equal(docs.get('legacy-meeting')?.notes, 'replaced');
  assert.equal(docs.size, 1);
});
