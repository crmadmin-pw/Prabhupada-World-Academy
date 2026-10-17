import assert from 'node:assert/strict';
import test from 'node:test';
import submit from '../src/api/submitSadhana';
import { Users, SadhanaEntries } from '../src/lib/app-backend-sdk';
import { calculateTotalScore, calculateNRPoints, computeSingleFieldScore, isNRCriteria, parseCriteria } from '../src/lib/scoring';
import { NON_RESIDENT_FIELDS, toFormField } from '../src/config/sadhanaFields';

// Mirrors DailySadhanaForm.enrichFieldValues: the browser scores every field,
// zeroes the fields a sick/OS day does not score, and sends the per-field points.
function enrichFieldValues(values: Record<string, any>, fields: any[], ashrayLevel: string, entryDate: string, sick: boolean) {
  const scoredKeys = sick ? new Set(['reading', 'chanting']) : null;
  const enriched: Record<string, any> = { ...values };
  const perField: Record<string, number> = {};
  for (const field of fields) {
    if (!field.contributesToScore) continue;
    if (scoredKeys && !scoredKeys.has(field.fieldKey)) {
      enriched[`_pts_${field.fieldKey}`] = 0;
      enriched[`_max_${field.fieldKey}`] = 0;
      continue;
    }
    const scored = computeSingleFieldScore({ field, value: values[field.fieldKey], ashrayLevel, entryDate, residencyBucket: '0-3' });
    enriched[`_pts_${field.fieldKey}`] = scored.points;
    enriched[`_max_${field.fieldKey}`] = scored.maxPoints;
    perField[field.fieldKey] = scored.points;
    const criteria = parseCriteria(field.criteria);
    if (isNRCriteria(criteria)) {
      const nr = calculateNRPoints(criteria, values[field.fieldKey], ashrayLevel, entryDate);
      enriched[`_nr_pts_${field.fieldKey}`] = nr.points;
      enriched[`_nr_max_${field.fieldKey}`] = nr.maxPoints;
    }
  }
  enriched._per_field = perField;
  return enriched;
}

const fields = NON_RESIDENT_FIELDS.map(field => toFormField(field)) as any[];
const todayInIndia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function browserSubmission(user: any, values: Record<string, any>, sick: boolean, entryDate = todayInIndia()) {
  const base = calculateTotalScore({ fields, values, ashrayLevel: user.ashrayLevel, entryDate, residencyBucket: '0-3', isSickOrOs: sick, isResident: false });
  const scorePercent = base.maxScore > 0 ? Math.round((base.totalScore / base.maxScore) * 100) : undefined;
  return {
    browser: base,
    input: {
      userId: user.id, entryDate, totalScore: base.totalScore, maxScore: base.maxScore, scorePercent,
      templateMode: 'NON_RESIDENT_TEMPLATE', ashrayLevelUsed: user.ashrayLevel,
      fieldValues: enrichFieldValues(values, fields, user.ashrayLevel, entryDate, sick),
      flagSick: sick, flagOs: false,
    },
  };
}

function mockStore(t: any, user: any) {
  const saved: any[] = [];
  t.mock.method(Users, 'findOne', async () => user);
  t.mock.method(SadhanaEntries, 'findOne', async () => null);
  t.mock.method(SadhanaEntries, 'create', async (args: any) => { saved.push(args.record); return args.record; });
  t.mock.method(SadhanaEntries, 'update', async () => assert.fail('a first submission must create, not update'));
  return saved;
}

test('an honest sick/OS non-resident day with full chanting and reading is accepted at 100%', async t => {
  for (const ashrayLevel of ['Jigyasa', 'Sevak', 'Harinam Diksha']) {
    const user = { id: `sick-${ashrayLevel}`, userId: 'U-SICK', status: 'Active', segment: 'FOLK', ashrayLevel };
    const saved = mockStore(t, user);
    const { browser, input } = browserSubmission(user, { chanting: 16, reading: 60, flags: ['Sick'] }, true);
    assert.equal(browser.scorePercent, 100, 'the form shows a full score for this day');
    const result = await submit.execute({ input, context: { user: { id: user.id, uid: 'uid' } } } as any);
    assert.equal(result.scorePercent, 100, `${ashrayLevel}: server must agree with the form`);
    assert.equal(result.maxScore, browser.maxScore);
    assert.equal(saved[0].scorePercent, 100);
    assert.equal(saved[0].flagSick, true);
  }
});

test('the stored maximum comes from the server, not from the browser payload', async t => {
  const user = { id: 'tamper', userId: 'U-T', status: 'Active', segment: 'FOLK', ashrayLevel: 'Jigyasa' };
  const saved = mockStore(t, user);
  const { browser, input } = browserSubmission(user, { chanting: 1, reading: 5 }, false);
  assert.ok(browser.scorePercent! < 100, 'a partial day must not already be a full score');
  // A tampered client shrinks the denominator and omits the percentage check.
  const result = await submit.execute({ input: { ...input, maxScore: 1, scorePercent: undefined }, context: { user: { id: user.id } } } as any);
  assert.equal(result.maxScore, browser.maxScore);
  assert.equal(result.scorePercent, browser.scorePercent);
  assert.equal(saved[0].maxScore, browser.maxScore);
});

test('a non-resident on an eligible level earns the same-day filing points the form shows', async t => {
  const user = { id: 'sevak', userId: 'U-S', status: 'Active', segment: 'FOLK', ashrayLevel: 'Sevak' };
  const saved = mockStore(t, user);
  const values = { chanting: 4, reading: 10, hearing: 10, wakeUptime: '05:00', sleepTime: '22:00', seva: true, bhaktiVriksha: true, fillingSameDay: true };
  const { browser, input } = browserSubmission(user, values, false);
  // The request context carries authorization fields only; the level is read from the database.
  const result = await submit.execute({ input, context: { user: { id: user.id, uid: 'uid', role: 'USER' } } } as any);
  assert.equal(result.totalScore, browser.totalScore);
  assert.equal(result.maxScore, browser.maxScore);
  const stored = JSON.parse(saved[0].fieldValuesJson);
  assert.equal(stored._pts_fillingSameDay, 4);
  assert.equal(stored._per_field.fillingSameDay, 4);
});

test('levels without the same-day field never receive its points', async t => {
  const user = { id: 'jigyasa', userId: 'U-J', status: 'Active', segment: 'FOLK', ashrayLevel: 'Jigyasa' };
  const saved = mockStore(t, user);
  const { browser, input } = browserSubmission(user, { chanting: 1, reading: 5, hearing: 5, fillingSameDay: true }, false);
  const result = await submit.execute({ input, context: { user: { id: user.id } } } as any);
  assert.equal(result.totalScore, browser.totalScore);
  assert.equal(JSON.parse(saved[0].fieldValuesJson)._pts_fillingSameDay, 0);
});

test('inflated per-field points are still rejected as tampering', async t => {
  const user = { id: 'cheat', userId: 'U-C', status: 'Active', segment: 'FOLK', ashrayLevel: 'Jigyasa' };
  mockStore(t, user);
  const { input } = browserSubmission(user, { chanting: 0, reading: 0 }, false);
  const inflated = { ...input, totalScore: 16, scorePercent: 100, fieldValues: { ...input.fieldValues, _pts_chanting: 8, _per_field: { ...input.fieldValues._per_field, chanting: 8 } } };
  await assert.rejects(() => submit.execute({ input: inflated, context: { user: { id: user.id } } } as any), /do not match/);
});
