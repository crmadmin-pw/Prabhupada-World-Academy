import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, Guides, FolkResidencies, SadhanaEntries } from '../src/lib/app-backend-sdk';
import { buildFolkHostelSadhanaScope, getFolkHostelSadhanaScope } from '../src/lib/folkHostelSadhanaScope';
import detailed from '../src/api/getGuideDetailedReport';
import createResidency from '../src/api/createResidency';
import assign from '../src/api/assignFolkResidencyGuides';

const guide = (id: string, extra = {}) => ({ id, userId: `USER-${id}`, email: `${id}@test.invalid`, fullName: id, role: 'Guide', status: 'Active', segment: 'FOLK', ...extra });
const a = guide('a'), b = guide('b'), c = guide('c');
const guides = [a, b, c].map(u => ({ ...u, id: `guide-${u.id}`, guideId: `GUIDE-${u.id}`, isActive: true }));
const centers = [{ id: 'powai', residencyId: 'RES-1', residencyName: 'FOLK Powai', guideIds: ['GUIDE-a', 'b'] }, { id: 'airoli', residencyName: 'FOLK Airoli', guideIds: ['c'] }];
const member = (id: string, extra = {}) => ({ id, userId: `USER-${id}`, fullName: id, status: 'Active', role: 'User', segment: 'FOLK', ...extra });
const members = [member('own', { guide: 'GUIDE-a', residency: 'airoli' }), member('peer-nr', { guide: ['USER-b'] }), member('resident', { guide: 'GUIDE-c', residency: ['RES-1'] }), member('foreign', { guide: 'c', residency: 'airoli' }), member('pw', { guide: 'a', segment: 'PW' })];

test('direct, hostel peer and residential exception access, with no PW leakage', () => {
  const scope = buildFolkHostelSadhanaScope(a, guides, [a, b, c], centers);
  assert.deepEqual(members.filter(scope.includes).map(u => u.id), ['own', 'peer-nr', 'resident']);
  assert.deepEqual(scope.availableGuides.map(g => g.guideId), ['guide-a', 'guide-b']);
  assert.equal(scope.matchesGuide(members[1], 'guide-b'), true);
  assert.equal(scope.matchesGuide(members[2], 'guide-c'), false);
  assert.equal(scope.includes(member('legacy', { residency: 'FOLK Powai' })), true);
  assert.equal(scope.includes(member('inactive', { guide: 'a', status: 'Inactive' })), false);
});

test('hostel revocation overrides stale denormalized links; direct access remains', () => {
  const scope = buildFolkHostelSadhanaScope(a, guides, [{ ...a, folkResidencies: ['powai'] }, b, c], [{ ...centers[0], guideIds: [] }]);
  assert.deepEqual(members.filter(scope.includes).map(u => u.id), ['own']);
  assert.deepEqual(scope.availableGuides, []);
});

test('legacy hostel links and temporary stays resolve; inactive hostels do not grant access', () => {
  const scope = buildFolkHostelSadhanaScope(a, guides, [{ ...a, folkResidencies: ['FOLK Powai'] }, b], [{ ...centers[0], guideIds: undefined, guides: 'b' }]);
  assert.equal(scope.includes(member('temporary', { temporaryResidency: 'powai', temporaryResidencyEnabled: true })), true);
  assert.equal(scope.includes(member('temporary-disabled', { temporaryResidency: 'powai', temporaryResidencyEnabled: false })), false);
  const inactive = buildFolkHostelSadhanaScope(a, guides, [a, b], [{ ...centers[0], isActive: false }]);
  assert.equal(inactive.includes(members[1]), false);
});

function mock(t: any) {
  for (const [table, records] of [[Users, [a, b, c, ...members]], [Guides, guides], [FolkResidencies, centers], [SadhanaEntries, []]] as any[]) {
    t.mock.method(table, 'findAll', async ({ filters = {}, offset = 0, limit = 2000 }: any = {}) => {
      const rows = records.filter((r: any) => Object.entries(filters).every(([k, v]) => r[k] === v));
      return { records: rows.slice(offset, offset + limit), hasMore: offset + limit < rows.length };
    });
    t.mock.method(table, 'findOne', async ({ id, filters = {} }: any) => records.find((r: any) => id ? r.id === id : Object.entries(filters).every(([k, v]) => r[k] === v)));
  }
}

test('detailed report ignores hostile scope selectors and permits only hostel guide filters', async t => {
  mock(t);
  const input = { guideId: 'c', date: '2026-10-20', reportType: 'daily', segment: 'FOLK' };
  const result = await detailed.execute({ input, context: { user: a } } as any);
  assert.deepEqual(result.users.map((u: any) => u.id).sort(), ['own', 'peer-nr', 'resident']);
  const filtered = await detailed.execute({ input: { ...input, filterGuideId: 'guide-b' }, context: { user: a } } as any);
  assert.deepEqual(filtered.users.map((u: any) => u.id), ['peer-nr']);
  const foreign = await detailed.execute({ input: { ...input, filterGuideId: 'guide-c' }, context: { user: a } } as any);
  assert.deepEqual(foreign.users, []);
});

test('PW callers never enter FOLK scope and cannot create or assign FOLK hostels', async () => {
  const pw = { ...a, segment: 'PW', role: 'Super Admin' };
  assert.equal(await getFolkHostelSadhanaScope(pw), null);
  await assert.rejects(createResidency.execute({ input: { residencyName: 'Test' }, context: { user: pw } } as any), /FOLK Super Guide/);
  await assert.rejects(assign.execute({ input: { residencyId: 'powai', guideIds: [] }, context: { user: pw } } as any), /FOLK Super Guide/);
});

test('missing report shares the same scope and guide filter', async t => {
  mock(t);
  const { default: missing } = await import('../src/api/getMissingSadhanaReport');
  const input = { guideId: 'c', startDate: '2026-10-20', endDate: '2026-10-20', segment: 'FOLK' };
  const result = await missing.execute({ input, context: { user: a } } as any);
  assert.deepEqual(result.users.map((u: any) => u.id).sort(), ['own', 'peer-nr', 'resident']);
  const filtered = await missing.execute({ input: { ...input, filterGuideId: 'guide-b' }, context: { user: a } } as any);
  assert.deepEqual(filtered.users.map((u: any) => u.id), ['peer-nr']);
});

test('a stale Guide token cannot retain hostel permissions after stored role removal', () => {
  const scope = buildFolkHostelSadhanaScope(a, guides, [{ ...a, role: 'User' }, b, c], centers);
  assert.equal(members.some(scope.includes), false);
});

test('Super FOLK Guide can create a hostel; a regular guide cannot', async t => {
  mock(t);
  const writes: any[] = [];
  t.mock.method(FolkResidencies, 'create', async ({ record }: any) => { writes.push(record); return { id: 'new-hostel', ...record }; });
  await assert.rejects(createResidency.execute({ input: { residencyName: 'New hostel' }, context: { user: a } } as any), /Super Guide/);
  const result = await createResidency.execute({ input: { residencyName: 'New hostel' }, context: { user: { ...a, role: 'Super Guide' } } } as any);
  assert.equal(result.residencyId, 'new-hostel');
  assert.deepEqual(writes[0].guideIds, []);
  assert.equal(writes[0].segment, 'FOLK');
});

test('hostel assignments synchronize both guide representations without modifying members', async t => {
  mock(t);
  const writes: any[] = [];
  for (const table of [Users, Guides, FolkResidencies]) {
    t.mock.method(table, 'update', async (args: any) => { writes.push({ table: table.tableName, ...args }); return args.record; });
  }
  await assign.execute({ input: { residencyId: 'powai', guideIds: ['guide-a', 'guide-b'] }, context: { user: { ...a, role: 'Super Guide' } } } as any);
  assert.deepEqual(writes.find(w => w.id === 'powai').record.guideIds, ['guide-a', 'guide-b']);
  for (const id of ['a', 'b', 'guide-a', 'guide-b']) assert.deepEqual(writes.find(w => w.id === id).record.folkResidencies, ['powai']);
  assert.equal(writes.some(w => members.some(m => m.id === w.id)), false);
});

test('ambiguous legacy guide names do not grant access and BKC retains Sion references', () => {
  const scope = buildFolkHostelSadhanaScope(a, guides.map(g => ({ ...g, fullName: 'Shared name' })), [a, b, c], [{ ...centers[0], residencyName: 'FOLK BKC', legacyNames: ['FOLK Sion'] }]);
  assert.equal(scope.includes(member('ambiguous', { guide: 'Shared name' })), false);
  assert.equal(scope.includes(member('old-resident', { residency: 'FOLK Sion' })), true);
});
