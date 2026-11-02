import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getBvQuizzes from '../src/api/getBvQuizzes';
import setBvQuizGroupActive from '../src/api/setBvQuizGroupActive';

const rgfAdmin = {
  id: 'profile-rgf-admin', userId: 'ADMIN-001', email: 'rgf-admin@example.test',
  fullName: 'RGF Admin', role: 'Admin', status: 'Active', segment: 'PW',
  isBvAdmin: true, isBvFacilitator: true, isBvsl: true,
};
const groups = [
  { id: 'own-group', groupId: 'OWN-GROUP', groupName: 'Own group', bvslLeader: rgfAdmin.id, bvslId: rgfAdmin.userId },
  { id: 'shared-group', groupId: 'SHARED-GROUP', groupName: 'Shared group', bvslLeader: ['other-rgf', rgfAdmin.id], bvslId: ['OTHER-RGF', rgfAdmin.userId] },
  { id: 'foreign-group', groupId: 'FOREIGN-GROUP', groupName: 'Other RGF group', bvslLeader: 'other-rgf', guide: rgfAdmin.id },
  { id: 'assistant-group', groupId: 'ASSISTANT-GROUP', groupName: 'RGSF only', bvslLeader: 'other-rgf', subFacilitatorId: rgfAdmin.id },
  { id: 'inactive-group', groupName: 'Inactive group', bvslLeader: rgfAdmin.id, isActive: false },
  { id: 'folk-group', groupName: 'FOLK group', bvslLeader: rgfAdmin.id, segment: 'FOLK' },
].map(group => ({ segment: 'PW', isActive: true, ...group }));

// Every database operation is mocked; activating a quiz here never writes live data.
function mockDatabase(t: any) {
  const quiz = { id: 'quiz', quizTitle: 'Test quiz', department: 'PW', isActive: true,
    questionsJson: '[]', activeGroupIds: ['foreign-group'] };
  const fixtures: Record<string, any[]> = { Users: [rgfAdmin], BvGroups: groups, BvQuizzes: [quiz] };
  const writes: any[] = [];
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    const query = (options: any = {}) => (fixtures[name] || [])
      .filter(row => (!options.id || row.id === options.id) && Object.entries(options.filters || {}).every(([field, value]: any) =>
        value?.in ? value.in.includes(row[field]) : row[field] === value))
      .map(row => options.fields ? Object.fromEntries(['id', ...options.fields].map((key: string) => [key, row[key]])) : { ...row });
    t.mock.method(table, 'findAll', async (options: any) => ({ records: query(options), hasMore: false }));
    t.mock.method(table, 'findOne', async (options: any) => query(options)[0] || null);
    for (const method of ['create', 'update', 'delete']) {
      t.mock.method(table, method, async () => { throw new Error(`Unexpected ${name}.${method}`); });
    }
  }
  t.mock.method(sdk.BvQuizzes, 'update', async (change: any) => {
    writes.push(change);
    Object.assign(quiz, change.record);
    return { ...quiz };
  });
  return { quiz, writes };
}

test('an admin who is also RGF sees the switch and toggles only their own groups', async t => {
  const { quiz, writes } = mockDatabase(t);
  for (const extra of [{}, { role: 'SUPER_ADMIN', isBvSuperAdmin: true }]) {
    const context = { user: { ...rgfAdmin, ...extra } };
    for (const groupId of ['own-group', 'SHARED-GROUP']) {
      const listed = await getBvQuizzes.execute({ input: { department: 'PW', groupId }, context } as never);
      assert.equal(listed.permissions.canManageContent, true);
      assert.equal(listed.permissions.canToggleGroups, true);
      assert.equal(listed.quizzes[0].isActiveForGroup, false);
      const input = { quizId: quiz.id, groupId, active: true };
      await setBvQuizGroupActive.execute({ input, context } as never);
      const enabled = await getBvQuizzes.execute({ input: { department: 'PW', groupId }, context } as never);
      assert.equal(enabled.quizzes[0].isActiveForGroup, true);
      assert.ok(quiz.activeGroupIds.includes('foreign-group'));
      await setBvQuizGroupActive.execute({ input: { ...input, active: false }, context } as never);
      assert.deepEqual(quiz.activeGroupIds, ['foreign-group']);
    }
    for (const groupId of ['foreign-group', 'assistant-group']) {
      const listed = await getBvQuizzes.execute({ input: { department: 'PW', groupId }, context } as never);
      assert.equal(listed.permissions.canManageContent, true);
      assert.equal(listed.permissions.canToggleGroups, false);
    }
    const count = writes.length;
    for (const groupId of ['foreign-group', 'assistant-group', 'inactive-group', 'folk-group', 'missing-group']) {
      for (const active of [true, false]) {
        await assert.rejects(setBvQuizGroupActive.execute({
          input: { quizId: quiz.id, groupId, active }, context,
        } as never), (error: any) => error.code === 'FORBIDDEN');
      }
    }
    assert.equal(writes.length, count);
  }
});

test('an RGF admin signing in through an Auth alias retains canonical group ownership', async t => {
  const { quiz, writes } = mockDatabase(t);
  const context = { user: { ...rgfAdmin, id: 'firebase-auth-alias', userId: undefined } };
  const result = await getBvQuizzes.execute({ input: { department: 'PW', groupId: 'own-group' }, context } as never);
  assert.equal(result.permissions.canToggleGroups, true);
  await setBvQuizGroupActive.execute({ input: { quizId: quiz.id, groupId: 'own-group', active: true }, context } as never);
  assert.equal(writes.length, 1);
  assert.deepEqual(quiz.activeGroupIds, ['foreign-group', 'own-group']);
});

test('ordinary RGF activation still works; admin-only, RGSF-only, inactive and FOLK callers cannot activate', async t => {
  const { quiz, writes } = mockDatabase(t);
  const rgf = { ...rgfAdmin, role: 'User', isBvAdmin: false };
  const listed = await getBvQuizzes.execute({ input: { department: 'PW', groupId: 'own-group' }, context: { user: rgf } } as never);
  assert.equal(listed.permissions.canManageContent, false);
  assert.equal(listed.permissions.canToggleGroups, true);
  await setBvQuizGroupActive.execute({ input: { quizId: quiz.id, groupId: 'own-group', active: true }, context: { user: rgf } } as never);
  assert.equal(writes.length, 1);
  for (const user of [
    { ...rgfAdmin, isBvFacilitator: false, isBvsl: false },
    { ...rgf, isBvFacilitator: false, isBvsl: false, role: 'RGSF', isBvSubFacilitator: true },
    { ...rgfAdmin, status: 'Inactive' },
    { ...rgfAdmin, segment: 'FOLK' },
  ]) {
    await assert.rejects(setBvQuizGroupActive.execute({
      input: { quizId: quiz.id, groupId: 'own-group', active: false }, context: { user },
    } as never), (error: any) => error.code === 'FORBIDDEN');
  }
  quiz.isActive = false;
  await assert.rejects(setBvQuizGroupActive.execute({
    input: { quizId: quiz.id, groupId: 'own-group', active: true }, context: { user: rgfAdmin },
  } as never), (error: any) => error.code === 'FORBIDDEN');
  assert.equal(writes.length, 1);
});
