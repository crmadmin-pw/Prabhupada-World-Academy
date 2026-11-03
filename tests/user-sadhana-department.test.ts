import assert from 'node:assert/strict';
import test from 'node:test';
import getSadhanaFormData, { FIELD_CACHE_KEY_NR } from '../src/api/getSadhanaFormData';
import submitSadhana from '../src/api/submitSadhana';
import setTemporaryResidency from '../src/api/setTemporaryResidency';
import { Users, SadhanaEntries, SadhanaFields } from '../src/lib/app-backend-sdk';
import { serverCacheInvalidate } from '../src/lib/serverCache';
import { residentTemplateMode, wasFolkResidentOnDate } from '../src/lib/folkResidencyHistory';
import updateUserResidency from '../src/api/updateUserResidency';
import { getTodayIST } from '../src/lib/streakUtils';

test('marking a FOLK resident again preserves the original move date', async t => {
  const member = { id: 'member', residency: 'hostel', residencyApproved: true, residentSince: '2026-09-07' };
  const updates: any[] = [];
  t.mock.method(Users, 'findOne', async () => member);
  t.mock.method(Users, 'update', async (update: any) => { updates.push(update.record); return update.record; });
  const context = { user: { id: 'guide', role: 'Super Guide', segment: 'FOLK' } };
  await updateUserResidency.execute({ input: { userId: member.id, makeResident: true, residencyId: 'hostel' }, context } as never);
  assert.equal(updates[0].residentSince, '2026-09-07');
  member.residencyApproved = false;
  await updateUserResidency.execute({ input: { userId: member.id, makeResident: true, residencyId: 'hostel' }, context } as never);
  assert.equal(updates[1].residentSince, getTodayIST());
});

test('FOLK residency begins on the move date and saved old NR entries keep their form', async t => {
  const member = { id: 'moved-member', userId: 'moved-member', segment: 'FOLK', residency: 'hostel',
    residencyApproved: true, residencyJoinDate: '2026-01-01', residentSince: '2026-09-07', ashrayLevel: 'Jigyasa' };
  let savedEntry: any = null;
  t.mock.method(Users, 'findOne', async () => member);
  t.mock.method(SadhanaEntries, 'findOne', async () => savedEntry);
  t.mock.method(SadhanaFields, 'findAll', async () => ({ records: [] }));
  serverCacheInvalidate(FIELD_CACHE_KEY_NR);
  t.after(() => serverCacheInvalidate(FIELD_CACHE_KEY_NR));
  assert.equal(wasFolkResidentOnDate(member, '2026-09-06'), false);
  assert.equal(wasFolkResidentOnDate(member, '2026-09-07'), true);
  assert.equal(residentTemplateMode('NR_TEMPLATE'), false);

  const before = await getSadhanaFormData.execute({ input: { entryDate: '2026-09-06' }, context: { user: member } } as never);
  const after = await getSadhanaFormData.execute({ input: { entryDate: '2026-09-07' }, context: { user: member } } as never);
  assert.equal(before.templateMode, 'NON_RESIDENT_TEMPLATE');
  assert.equal(after.templateMode, 'RESIDENT_TEMPLATE');

  savedEntry = { id: 'old-entry', templateMode: 'NR_TEMPLATE', fieldValuesJson: '{}' };
  const reopened = await getSadhanaFormData.execute({ input: { entryDate: '2026-09-07' }, context: { user: member } } as never);
  assert.equal(reopened.templateMode, 'NON_RESIDENT_TEMPLATE');
  assert.equal(reopened.exists, true);
});

for (const { segment, official, temporary, resident } of [
  { segment: 'PW', official: true, temporary: true, resident: false },
  { segment: 'PW', official: false, temporary: true, resident: false },
  { segment: 'FOLK', official: true, temporary: false, resident: true },
  { segment: 'FOLK', official: false, temporary: true, resident: true },
  { segment: 'FOLK', official: false, temporary: false, resident: false },
]) {
  test(`${segment} form with official=${official}, temporary=${temporary} uses resident=${resident}`, async t => {
    const member = { id: 'form-member', userId: 'legacy-member', segment, residency: 'residency', residencyApproved: official,
      temporaryResidencyEnabled: temporary, temporaryResidency: 'temporary-residency' };
    t.mock.method(Users, 'findOne', async () => member);
    t.mock.method(SadhanaEntries, 'findOne', async () => null);
    t.mock.method(SadhanaFields, 'findAll', async () => ({ records: [] }));
    serverCacheInvalidate(FIELD_CACHE_KEY_NR);
    t.after(() => serverCacheInvalidate(FIELD_CACHE_KEY_NR));
    const result = await getSadhanaFormData.execute({ input: { entryDate: '2026-09-06' }, context: { user: member } } as never);
    assert.equal(result.isResident, resident);
    assert.equal(result.templateMode, resident ? 'RESIDENT_TEMPLATE' : 'NON_RESIDENT_TEMPLATE');
    assert.equal(result.fields.some((field: { fieldKey: string }) => field.fieldKey === 'cleanliness'), resident);
    if (segment === 'PW') {
      assert.equal(result.tempResidencyEnabled, false);
      assert.equal(result.tempResidencyId, null);
    }
  });
}

test('PW cannot submit a FOLK resident template or enable temporary residency', async t => {
  const member = { id: 'pw-member', segment: 'PW', status: 'Active' };
  t.mock.method(Users, 'findOne', async () => member);
  t.mock.method(Users, 'update', async () => { assert.fail('PW residency must not be written'); });
  t.mock.method(SadhanaEntries, 'create', async () => { assert.fail('PW resident entry must not be written'); });
  const context = { user: member };
  await assert.rejects(() => submitSadhana.execute({ input: {
    userId: member.id, entryDate: '2026-09-06', templateMode: 'RESIDENT_TEMPLATE', totalScore: 0, fieldValues: {},
  }, context } as never), /non-resident Sadhana form/);
  await assert.rejects(() => setTemporaryResidency.execute({ input: {
    enabled: true, residencyId: 'residency',
  }, context } as never), /only to FOLK/);
});

test('FOLK can still enable and clear temporary residency', async t => {
  const member = { id: 'folk-member', segment: 'FOLK' };
  t.mock.method(Users, 'findOne', async () => member);
  const writes: unknown[] = [];
  t.mock.method(Users, 'update', async (value: unknown) => { writes.push(value); return member; });
  for (const enabled of [true, false]) {
    const result = await setTemporaryResidency.execute({ input: { enabled, residencyId: 'residency' }, context: { user: member } } as never);
    assert.equal(result.success, true);
  }
  assert.deepEqual(writes, [
    { id: member.id, record: { temporaryResidencyEnabled: true, temporaryResidency: 'residency' } },
    { id: member.id, record: { temporaryResidencyEnabled: false, temporaryResidency: undefined } },
  ]);
});
