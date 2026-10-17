import assert from 'node:assert/strict';
import test from 'node:test';
import getEntryDetail from '../src/api/getEntryDetail';
import getBvPreachingEntry from '../src/api/getBvPreachingEntry';
import saveOneToOneEligibility from '../src/api/saveOneToOneEligibility';
import { BvGroupMembers, BvGroups, BvslPreachingEntries, FolkResidencies, Guides, SadhanaEntries, Users } from '../src/lib/app-backend-sdk';

// The entry detail modal is opened from a member's own history and from the
// guide's member page. Access follows the same hierarchy rule as the CRM data
// shown beside it: own data, members in the caller's hierarchy, or a super guide.
const guide = { id: 'guide-db', userId: 'GUIDE-1', email: 'guide@example.invalid', role: 'Guide', status: 'Active', segment: 'FOLK' };
const member = { id: 'member-db', userId: 'USER-7', email: 'member@example.invalid', role: 'User', status: 'Active', segment: 'FOLK', guide: guide.id };
const outsider = { id: 'outsider-db', userId: 'USER-8', email: 'outsider@example.invalid', role: 'User', status: 'Active', segment: 'FOLK', guide: 'another-guide' };
const superGuide = { id: 'super-db', userId: 'SUPER-1', email: 'super@example.invalid', role: 'Super Guide', status: 'Active', segment: 'FOLK' };
const entry = { id: 'entry-1', entryId: 'ENTRY-1', user: member.id, entryDate: '2026-01-05', totalScore: 10, maxScore: 16, templateMode: 'NON_RESIDENT_TEMPLATE', fieldValuesJson: JSON.stringify({ chanting: 16 }) };
const preaching = { id: 'preach-1', user: member.id, entryDate: '2026-01-05', prBooksDistributed: 3 };

function matches(record: any, query: any = {}) {
  if (query.id && record.id !== query.id) return false;
  return Object.entries(query.filters || {}).every(([key, value]: any) => {
    const actual = [record[key]].flat();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(value.in)) return actual.some(item => value.in.includes(item));
      return true;
    }
    return actual.includes(value);
  });
}

function seed(t: any) {
  const tables: Array<[any, any[]]> = [
    [Users, [guide, member, outsider, superGuide]],
    [Guides, [{ id: guide.id, guideId: guide.userId, email: guide.email, isActive: true }]],
    [BvGroups, []], [BvGroupMembers, []], [FolkResidencies, []],
    [SadhanaEntries, [entry]], [BvslPreachingEntries, [preaching]],
  ];
  const updates: any[] = [];
  for (const [table, rows] of tables) {
    t.mock.method(table, 'findAll', async (options: any = {}) => ({ records: options.offset ? [] : rows.filter(row => matches(row, options)), hasMore: false }));
    t.mock.method(table, 'findOne', async (options: any = {}) => rows.filter(row => matches(row, options))[0]);
    t.mock.method(table, 'update', async (args: any) => { updates.push(args); return args.record; });
  }
  return updates;
}

const context = (user: any) => ({ user: { id: user.id, uid: `uid-${user.id}`, userId: user.userId, email: user.email, role: user.role, segment: user.segment, normalizedRole: user.role.toUpperCase().replace(/\s+/g, '_') } });

test('a member reads their own entry detail and preaching entry', async t => {
  seed(t);
  const detail: any = await getEntryDetail.execute({ input: { userId: member.userId, entryDate: '2026-01-05' }, context: context(member) } as any);
  assert.equal(detail.found, true);
  const own: any = await getBvPreachingEntry.execute({ input: { entryDate: '2026-01-05' }, context: context(member) } as any);
  assert.equal(own.found, true);
  assert.equal(own.entry.booksDistributed, 3);
});

test('the member\'s guide and a super guide can open the same entry', async t => {
  seed(t);
  for (const viewer of [guide, superGuide]) {
    const byDate: any = await getEntryDetail.execute({ input: { userId: member.userId, entryDate: '2026-01-05' }, context: context(viewer) } as any);
    assert.equal(byDate.found, true, viewer.role);
    const byId: any = await getEntryDetail.execute({ input: { entryId: entry.entryId }, context: context(viewer) } as any);
    assert.equal(byId.found, true, viewer.role);
    const preachingView: any = await getBvPreachingEntry.execute({ input: { userId: member.userId, entryDate: '2026-01-05' }, context: context(viewer) } as any);
    assert.equal(preachingView.found, true, viewer.role);
  }
});

test('a member outside the caller\'s hierarchy is refused, by date and by entry id', async t => {
  seed(t);
  for (const input of [{ userId: member.userId, entryDate: '2026-01-05' }, { entryId: entry.entryId }]) {
    await assert.rejects(() => getEntryDetail.execute({ input, context: context(outsider) } as any), /not assigned to your hierarchy/);
  }
  await assert.rejects(() => getBvPreachingEntry.execute({ input: { userId: member.userId, entryDate: '2026-01-05' }, context: context(outsider) } as any), /not assigned to your hierarchy/);
});

test('1:1 eligibility can be set by the member\'s guide but not by an unrelated member', async t => {
  const updates = seed(t);
  const result = await saveOneToOneEligibility.execute({ input: { userId: member.id, eligibility: 'Not Eligible' }, context: context(guide) } as any);
  assert.equal(result.success, true);
  assert.equal(updates[0].record.oneToOneEligibility, 'Not Eligible');
  await assert.rejects(() => saveOneToOneEligibility.execute({ input: { userId: member.id, eligibility: 'Guide' }, context: context(outsider) } as any), /not assigned to your hierarchy/);
  assert.equal(updates.length, 1);
});
