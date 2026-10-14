import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import updateBvGroup from '../src/api/updateBvGroup';
import joinGroupByToken from '../src/api/joinGroupByToken';
import { bvWhatsAppJoinUrl, bvWhatsAppShareUrl, isEmbeddedInviteBrowser } from '../src/lib/bvJoinToken';
import { reportingChainWrite } from '../src/lib/app-backend-sdk';

function matches(record: any, filters: any) {
  return Object.entries(filters || {}).every(([field, value]) => {
    const actual = Array.isArray(record[field]) ? record[field][0] : record[field];
    return String(actual || '') === String(value || '');
  });
}

function installMemory(t: any, tables: Record<string, any[]>) {
  const stores: Record<string, any[]> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map(row => ({ ...row }))]),
  );
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function' || !stores[name]) continue;
    const rows = () => stores[name];
    t.mock.method(table, 'findAll', async (options: any = {}) => ({
      records: rows().filter(record => (!options.id || record.id === options.id) && matches(record, options.filters)),
      hasMore: false,
    }));
    t.mock.method(table, 'findOne', async (options: any = {}) => {
      if (options.id) return rows().find(record => record.id === options.id);
      return rows().find(record => matches(record, options.filters));
    });
    t.mock.method(table, 'update', async ({ id, record }: { id: string; record: any }) => {
      const row = rows().find(item => item.id === id);
      if (!row) throw new Error(`Missing ${name}/${id}`);
      Object.assign(row, record);
      return row;
    });
    t.mock.method(table, 'create', async ({ record }: { record: any }) => {
      const row = { id: `${name}-${rows().length + 1}`, ...record };
      stores[name].push(row);
      return row;
    });
  }
  return stores;
}

const rgf = { id: 'rgf-doc', userId: 'rgf-public', role: 'User', isBvFacilitator: true, fullName: 'Ramya Devi Dasi' };
const member = { id: 'member-user', userId: 'member-public', role: 'User', email: 'member@example.test' };

test('a WhatsApp invite opens the send composer instead of a numberless wa.me link', () => {
  const share = new URL(bvWhatsAppShareUrl('Hare Krishna!\n\nClick to join: https://academy.prabhupadaworld.com/join/inviteToken1/pw'));
  assert.equal(share.origin + share.pathname, 'https://api.whatsapp.com/send');
  assert.match(share.searchParams.get('text') || '', /\/join\/inviteToken1\/pw/);
  assert.equal(share.hostname.includes('wa.me'), false);
  assert.equal(isEmbeddedInviteBrowser('Mozilla/5.0 WhatsApp/2.23'), true);
  assert.equal(isEmbeddedInviteBrowser('Mozilla/5.0 Chrome/120'), false);
  assert.equal(reportingChainWrite('BvGroups', { joinToken: 'inviteToken1' }), false);
  assert.equal(reportingChainWrite('BvGroups', { bvslId: 'rgf-public' }), true);
});

test('a PW WhatsApp invite link ends with /pw and carries the group token', () => {
  const url = new URL(bvWhatsAppJoinUrl('https://academy.prabhupadaworld.com', 'inviteToken1', true));
  assert.equal(url.origin + url.pathname, 'https://academy.prabhupadaworld.com/join/inviteToken1/pw');
  assert.equal(url.pathname.endsWith('/pw'), true);
  assert.equal(bvWhatsAppJoinUrl('https://academy.prabhupadaworld.com', 'inviteToken1', false), 'https://academy.prabhupadaworld.com/join-group?token=inviteToken1');
});

test('an RGF can mint a stable invite token and a member cannot', async t => {
  const stores = installMemory(t, {
    BvGroups: [{ id: 'group-doc', groupId: 'group-public', groupName: 'Gauranga 1.30', bvslLeader: 'rgf-doc', segment: 'PW', isActive: true }],
    Users: [],
    Guides: [],
    BvGroupMembers: [],
  });

  await assert.rejects(
    () => updateBvGroup.execute({ input: { groupId: 'group-public', ensureJoinToken: true }, context: { user: member } } as never),
    /Only this group's RGF or an admin/,
  );
  assert.equal(stores.BvGroups[0].joinToken, undefined);

  const minted = await updateBvGroup.execute({
    input: { groupId: 'group-public', ensureJoinToken: true },
    context: { user: rgf },
  } as never);
  assert.equal(minted.joinToken, stores.BvGroups[0].joinToken);
  assert.equal(String(minted.joinToken).length, 16);

  stores.BvGroups[0].joinToken = 'keep-me';
  const again = await updateBvGroup.execute({
    input: { groupId: 'group-doc', ensureJoinToken: true },
    context: { user: rgf },
  } as never);
  assert.equal(again.joinToken, 'keep-me');
});

test('an RGF stored only by name or guide id can still mint an invite', async t => {
  const stores = installMemory(t, {
    BvGroups: [
      { id: 'named-group', groupId: 'named-public', groupName: 'Gauranga', bvslName: 'Ramya Devi Dasi', segment: 'PW', isActive: true },
      { id: 'guide-group', groupId: 'guide-public', groupName: 'Gauranga 1:30', bvslLeader: 'guide-doc', bvslName: 'Ramya Devi Dasi', segment: 'PW', isActive: true },
    ],
    Users: [],
    Guides: [{ id: 'guide-doc', guideId: 'guide-public-id', email: 'ramya@example.test', fullName: 'Ramya Devi Dasi' }],
    BvGroupMembers: [],
  });

  const byName = await updateBvGroup.execute({
    input: { groupId: 'named-public', ensureJoinToken: true },
    context: { user: { ...rgf, email: 'ramya@example.test' } },
  } as never);
  assert.equal(String(byName.joinToken).length, 16);
  assert.equal(stores.BvGroups[0].joinToken, byName.joinToken);

  const byGuide = await updateBvGroup.execute({
    input: { groupId: 'guide-public', ensureJoinToken: true },
    context: { user: { id: 'other-doc', userId: 'other-public', email: 'ramya@example.test', fullName: 'Someone Else', role: 'User', isBvFacilitator: true } },
  } as never);
  assert.equal(String(byGuide.joinToken).length, 16);
});

test('opening an invite adds the person to that Bhakti Vriksha group', async t => {
  const stores = installMemory(t, {
    BvGroups: [{
      id: 'group-doc',
      groupId: 'group-public',
      groupName: 'Gauranga 1.30',
      joinToken: 'inviteToken1',
      isActive: true,
      bvslLeader: 'rgf-doc',
      bvslName: 'Ramya Devi Dasi',
    }],
    Users: [
      { id: 'member-user', userId: 'member-public', email: 'member@example.test', fullName: 'New Devotee', status: 'Active' },
      rgf,
    ],
    BvGroupMembers: [],
  });

  const unregistered = await joinGroupByToken.execute({
    input: { token: 'inviteToken1' },
    context: { user: { id: 'firebase-uid', userId: 'firebase-uid', email: 'new@example.test' } },
  } as never);
  assert.equal(unregistered.needsRegistration, true);
  assert.equal(stores.BvGroupMembers.length, 0);

  const joined = await joinGroupByToken.execute({
    input: { token: 'inviteToken1' },
    context: { user: member },
  } as never);
  assert.equal(joined.success, true);
  assert.equal(joined.groupName, 'Gauranga 1.30');
  assert.equal(stores.BvGroupMembers.length, 1);
  assert.equal(stores.BvGroupMembers[0].group, 'group-doc');
  assert.equal(stores.BvGroupMembers[0].user, 'member-user');
  assert.equal(stores.Users.find(user => user.id === 'member-user')?.bvGroupId, 'group-doc');
  assert.equal(stores.Users.find(user => user.id === 'member-user')?.bvGroupName, 'Gauranga 1.30');
  assert.equal(stores.Users.find(user => user.id === 'member-user')?.isBvMember, true);
  assert.equal(stores.Users.find(user => user.id === 'member-user')?.bvReportingFacilitatorId, 'rgf-public');

  const again = await joinGroupByToken.execute({
    input: { token: 'inviteToken1' },
    context: { user: member },
  } as never);
  assert.match(again.message, /already a member/);
  assert.equal(stores.BvGroupMembers.length, 1);
});
