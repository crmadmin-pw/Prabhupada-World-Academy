import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import endpoint from '../src/api/hardDeleteBvGroups';
import { buildApiUserContext, hasApiCapabilities } from '../src/lib/apiAuthorization';
import { BV_DELETE_CONFIRMATION, confirmBvGroupDeletion } from '../src/lib/confirmBvGroupDeletion';
import { deleteBvGroupsWithAudit } from '../src/lib/deleteBvGroupsWithAudit';

const identity = { uid: 'auth-super', email: 'super@example.test', emailVerified: true };
const user = (role: string, extra = {}) => buildApiUserContext(identity, {
  id: 'profile-super', userId: 'SUPER-001', role, status: 'Active', ...extra,
});
const superAdmin = user('Super Admin');
const confirmed = { deleteAll: true, confirmationPhrase: BV_DELETE_CONFIRMATION };

test('only active, exact super-admin authority passes the endpoint capability policy', async () => {
  assert.equal(endpoint.requiredCapabilities, '*');
  for (const role of ['Supervisor', 'Superviser', 'Super Guide', 'Super Admin Assistant', 'Admin', 'User']) {
    const caller = user(role);
    assert.equal(hasApiCapabilities(caller, endpoint.requiredCapabilities), false, role);
    for (const selection of [{ deleteAll: true }, { groupIds: ['g1'] }, { groupNames: ['Group'] }]) {
      await assert.rejects(endpoint.execute({ input: { ...selection, confirmationPhrase: BV_DELETE_CONFIRMATION }, context: { user: caller } }), /Super Admin access required/);
    }
  }
  for (const caller of [user('Super Admin', { status: 'Inactive' }), user('User', { isBvSuperAdmin: 'true' })]) {
    assert.equal(hasApiCapabilities(caller, '*'), false);
  }
  for (const caller of [superAdmin, user('SUPER_ADMIN'), user('User', { isBvSuperAdmin: true })]) {
    assert.equal(hasApiCapabilities(caller, '*'), true);
  }
  await assert.rejects(endpoint.execute({ input: confirmed, context: { user: null } } as never), /Super Admin access required/);
});

test('direct handler and schema reject missing, mistyped, or padded confirmation before accessing storage', async () => {
  for (const phrase of [undefined, '', 'DELETE', 'delete bv groups', 'DELETE BV GROUPS ']) {
    const input = { deleteAll: true, confirmationPhrase: phrase };
    assert.equal(endpoint.inputSchema.safeParse(input).success, false);
    await assert.rejects(endpoint.execute({ input, context: { user: superAdmin } } as never));
  }
  assert.equal(endpoint.inputSchema.safeParse(confirmed).success, true);
  assert.equal(endpoint.inputSchema.safeParse({ confirmationPhrase: BV_DELETE_CONFIRMATION }).success, false);
});

test('client prompt requires actual exact input and identifies the deletion scope', () => {
  for (const answer of [null, '', 'DELETE', 'delete bv groups', 'DELETE BV GROUPS ']) {
    assert.throws(() => confirmBvGroupDeletion(true, () => answer), /Deletion cancelled/);
  }
  assert.equal(confirmBvGroupDeletion(true, message => {
    assert.match(message, /ALL Bhakti Vriksha groups and memberships/);
    assert.match(message, /cannot be undone/);
    return BV_DELETE_CONFIRMATION;
  }), BV_DELETE_CONFIRMATION);
  confirmBvGroupDeletion(false, message => {
    assert.match(message, /selected Bhakti Vriksha groups/);
    return BV_DELETE_CONFIRMATION;
  });
});

type Row = { id: string; [key: string]: unknown };
function database(groups: Row[], memberships: Row[], failure?: 'intent' | 'read' | 'receipt' | 'second-batch' | 'completion') {
  const stored = new Map<string, Record<string, unknown>>();
  groups.forEach(({ id, ...data }) => stored.set(`BvGroups/${id}`, data));
  memberships.forEach(({ id, ...data }) => stored.set(`BvGroupMembers/${id}`, data));
  let commits = 0;
  const ref = (path: string): any => ({
    path, id: path.split('/').at(-1),
    collection: (name: string) => collection(`${path}/${name}`),
    create: async (data: Record<string, unknown>) => {
      if (failure === 'intent') throw new Error('intent unavailable');
      assert.equal(stored.has(path), false);
      stored.set(path, data);
    },
    update: async (data: Record<string, unknown>) => {
      if (failure === 'completion' && data.status === 'completed') throw new Error('completion unavailable');
      assert.ok(stored.has(path));
      stored.set(path, { ...stored.get(path), ...data });
    },
  });
  const collection = (name: string): any => ({
    doc: (id = 'audit-1') => ref(`${name}/${id}`),
    select: () => ({ get: async () => {
      if (failure === 'read') throw new Error('read unavailable');
      return { docs: [...stored.entries()].filter(([path]) => path.startsWith(`${name}/`)).map(([path, data]) => ({
        id: path.split('/').at(-1), ref: ref(path), data: () => data, updateTime: 'snapshot-version',
      })) };
    } }),
  });
  const db = { collection, batch: () => {
    const pending: (() => void)[] = [];
    return {
      delete: (doc: any, precondition: any) => {
        assert.equal(precondition.lastUpdateTime, 'snapshot-version');
        pending.push(() => { stored.delete(doc.path); });
      },
      create: (doc: any, data: any) => {
        pending.push(() => { stored.set(doc.path, data); });
      },
      commit: async () => {
        commits++;
        if (failure === 'receipt' || (failure === 'second-batch' && commits === 2)) throw new Error('batch unavailable');
        assert.ok(stored.has('auditLogs/audit-1'), 'intent precedes all deletes');
        assert.ok(pending.length <= 401);
        pending.forEach(write => write());
      },
    };
  } } as unknown as Firestore;
  return { db, stored, audit: () => stored.get('auditLogs/audit-1')! };
}

test('full wipe includes orphan memberships and records verified actor, scope, time, counts and deleted paths', async () => {
  const memory = database([{ id: 'g1', groupName: 'Group' }], [{ id: 'm1', group: 'g1' }, { id: 'orphan', group: 'missing' }]);
  const result = await deleteBvGroupsWithAudit(memory.db, confirmed, superAdmin);
  assert.equal(result.deleted, 1);
  assert.equal(result.auditId, 'audit-1');
  assert.deepEqual([...memory.stored.keys()].sort(), ['auditLogs/audit-1', 'auditLogs/audit-1/batches/0']);
  const audit = memory.audit();
  assert.equal(audit.actorUid, identity.uid);
  assert.equal(audit.actorEmail, identity.email);
  assert.equal(audit.actorId, 'profile-super');
  assert.equal(audit.scope, 'all');
  assert.equal(audit.status, 'completed');
  assert.ok(audit.timestamp);
  assert.ok(audit.completedAt);
  assert.equal(audit.deletedGroups, 1);
  assert.equal(audit.deletedMemberships, 2);
  assert.deepEqual(memory.stored.get('auditLogs/audit-1/batches/0')?.deletedPaths, ['BvGroupMembers/m1', 'BvGroupMembers/orphan', 'BvGroups/g1']);
});

test('selected deletion deduplicates selectors, resolves membership aliases, and preserves unrelated groups', async () => {
  const memory = database([
    { id: 'g1', groupId: 'GROUP-001', groupName: 'Selected' },
    { id: 'g2', groupName: 'Keep' },
  ], [
    { id: 'm1', group: ['GROUP-001'] }, { id: 'm2', groupId: 'g1' }, { id: 'm3', group: 'g2' },
  ]);
  const result = await deleteBvGroupsWithAudit(memory.db, { groupIds: ['g1', 'g1'], groupNames: ['Selected'] }, superAdmin);
  assert.equal(result.deleted, 1);
  assert.ok(memory.stored.has('BvGroups/g2'));
  assert.ok(memory.stored.has('BvGroupMembers/m3'));
  assert.equal(memory.audit().deletedMemberships, 2);
  assert.equal(memory.audit().scope, 'selected');
});

for (const failure of ['intent', 'read', 'receipt'] as const) {
  test(`${failure} failure prevents every destructive write`, async () => {
    const memory = database([{ id: 'g1' }], [{ id: 'm1', group: 'g1' }], failure);
    await assert.rejects(deleteBvGroupsWithAudit(memory.db, confirmed, superAdmin));
    assert.ok(memory.stored.has('BvGroups/g1'));
    assert.ok(memory.stored.has('BvGroupMembers/m1'));
    assert.equal(memory.stored.has('auditLogs/audit-1/batches/0'), false);
    if (failure !== 'intent') assert.equal(memory.audit().status, 'failed_or_partial');
  });
}

test('large deletions retain atomic receipts for completed batches when a later batch fails', async () => {
  const memory = database([{ id: 'g1' }], Array.from({ length: 1001 }, (_, i) => ({ id: `m${i}`, group: 'g1' })), 'second-batch');
  await assert.rejects(deleteBvGroupsWithAudit(memory.db, confirmed, superAdmin), /batch unavailable/);
  assert.ok(memory.stored.has('BvGroups/g1'));
  assert.equal([...memory.stored.keys()].filter(path => path.startsWith('BvGroupMembers/')).length, 601);
  assert.equal((memory.stored.get('auditLogs/audit-1/batches/0')?.deletedPaths as string[]).length, 400);
  assert.equal(memory.stored.has('auditLogs/audit-1/batches/1'), false);
  assert.equal(memory.audit().status, 'failed_or_partial');
});

test('completion-status failure returns an error and preserves the committed deletion receipt', async () => {
  const memory = database([{ id: 'g1' }], [], 'completion');
  await assert.rejects(deleteBvGroupsWithAudit(memory.db, confirmed, superAdmin), /completion unavailable/);
  assert.equal(memory.stored.has('BvGroups/g1'), false);
  assert.ok(memory.stored.has('auditLogs/audit-1/batches/0'));
  assert.equal(memory.audit().status, 'failed_or_partial');
});

test('full wipe is not truncated at the old 5000-group or 1000-membership limits', async () => {
  const memory = database(
    Array.from({ length: 5001 }, (_, i) => ({ id: `g${i}` })),
    Array.from({ length: 1001 }, (_, i) => ({ id: `m${i}`, group: 'g0' })),
  );
  const result = await deleteBvGroupsWithAudit(memory.db, confirmed, superAdmin);
  assert.equal(result.deleted, 5001);
  assert.equal(memory.audit().deletedMemberships, 1001);
  assert.equal([...memory.stored.keys()].filter(path => path.startsWith('Bv')).length, 0);
  assert.equal([...memory.stored.keys()].filter(path => path.includes('/batches/')).length, 16);
});
