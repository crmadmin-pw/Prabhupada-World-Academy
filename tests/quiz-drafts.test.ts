import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import create from '../src/api/createBvQuiz';
import detail from '../src/api/getBvQuizDetail';
import list from '../src/api/getBvQuizzes';
import remove from '../src/api/deleteBvQuiz';
import results from '../src/api/getBvQuizSubmissions';
import activate from '../src/api/setBvQuizGroupActive';
import { assertQuizParticipantAccess } from '../src/lib/bvQuizAccess';
import * as sdk from '../src/lib/app-backend-sdk';

const admin = { id: 'author', userId: 'AUTHOR', email: 'author@example.test', role: 'ADMIN', segment: 'PW', status: 'Active', isActive: true, isBvAdmin: true };

function database(t: TestContext) {
  const quizzes: Record<string, unknown>[] = [];
  for (const [name, table] of Object.entries(sdk)) {
    if (!table || typeof table !== 'object' || !('findAll' in table)) continue;
    const rows = name === 'BvQuizzes' ? quizzes : name === 'Users' ? [admin] : name === 'BvGroups' ? [{ id: 'group', segment: 'FOLK', bvslLeader: admin.id, isActive: true }] : [];
    const find = (query: { id?: string; filters?: Record<string, unknown> } = {}) => rows.filter(row =>
      (!query.id || row.id === query.id) && Object.entries(query.filters || {}).every(([key, value]) =>
        value && typeof value === 'object' && 'in' in value ? (value.in as unknown[]).includes(row[key]) : row[key] === value));
    t.mock.method(table, 'findOne', async (query: Parameters<typeof find>[0]) => find(query)[0]);
    t.mock.method(table, 'findAll', async (query: Parameters<typeof find>[0]) => ({ records: find(query), hasMore: false }));
  }
  t.mock.method(sdk.BvQuizzes, 'create', async ({ record }: { record: Record<string, unknown> }) => {
    const row = { ...record, id: `quiz-${quizzes.length}` };
    quizzes.push(row);
    return row;
  });
  t.mock.method(sdk.BvQuizzes, 'update', async ({ id, record }: { id: string; record: Record<string, unknown> }) => Object.assign(quizzes.find(row => row.id === id)!, record));
  return quizzes;
}

test('incomplete drafts save privately, reject participation and validate before publishing', async t => {
  const quizzes = database(t);
  const input = { department: 'PW' as const, title: 'Work in progress', publicationStatus: 'draft' as const,
    questions: [{ id: 'q1', text: '', type: 'single' as const, options: ['', ''], correctAnswers: [] }] };
  assert.equal(create.inputSchema.safeParse(input).success, true);
  const saved = await create.execute({ input, context: { user: admin } } as never);
  const quiz = quizzes[0];
  assert.equal(quiz.isActive, false);
  assert.equal(quiz.publicationStatus, 'draft');
  assert.equal((await detail.execute({ input: { quizId: saved.quizId, includeAnswers: true }, context: { user: admin } } as never)).questions[0].text, '');
  const other = { ...admin, id: 'other-admin' };
  for (const endpoint of [detail, remove, results]) {
    await assert.rejects(() => endpoint.execute({ input: { quizId: saved.quizId, department: 'PW', includeAnswers: true }, context: { user: other } } as never), /private to its creator/);
  }
  assert.equal((await list.execute({ input: { department: 'PW' }, context: { user: other } } as never)).quizzes.length, 0);
  assert.equal((await list.execute({ input: { department: 'PW' }, context: { user: admin } } as never)).quizzes[0].publicationStatus, 'draft');
  await assert.rejects(() => assertQuizParticipantAccess({ ...admin, role: 'User' }, { ...quiz, isActive: true }), /not available/);
  await assert.rejects(() => activate.execute({ input: { quizId: saved.quizId, groupId: 'group', active: true }, context: { user: { ...admin, isBvFacilitator: true } } } as never), /Publish/);
  await assert.rejects(() => create.execute({ input: { ...input, quizId: saved.quizId, publicationStatus: 'published' }, context: { user: admin } } as never), /before publishing/);
  await create.execute({ input: { ...input, quizId: saved.quizId, publicationStatus: 'published', questions: [{ id: 'q1', text: 'Ready?', type: 'single', options: ['Yes', 'No'], correctAnswers: [0] }] }, context: { user: admin } } as never);
  assert.equal(quiz.publicationStatus, 'published');
  assert.equal(quiz.isActive, true);
  assert.equal((await list.execute({ input: { department: 'PW' }, context: { user: other } } as never)).quizzes.length, 1);
});

test('FOLK draft preserves incomplete questions and publishes only to an authorized group', async t => {
  const quizzes = database(t);
  const context = { user: { ...admin, role: 'BVSL', segment: 'FOLK', isBvsl: true } };
  const input = { department: 'FOLK', groupId: 'group', title: '', publicationStatus: 'draft', questions: [] };
  const created = await create.execute({ input, context } as never);
  assert.equal(quizzes[0].isActive, false);
  assert.equal(quizzes[0].quizTitle, 'Untitled Quiz');
  await create.execute({ input: { ...input, title: 'FOLK quiz', quizId: created.quizId, publicationStatus: 'published', questions: [{ id: 'q', text: 'Ready?', type: 'single', options: ['Yes', 'No'], correctAnswers: [0] }] }, context } as never);
  assert.equal(quizzes[0].isActive, true);
});
