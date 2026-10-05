import assert from 'node:assert/strict';
import test from 'node:test';
import { Users, Guides, BvGroups, BvGroupMembers, BvGroupRequests, BvQuizzes, BvQuizSubmissions, BvAttendance, FolkResidencies } from '../src/lib/app-backend-sdk';
import getMyBvQuizSubmissions from '../src/api/getMyBvQuizSubmissions';
import getUserBvStatus from '../src/api/getUserBvStatus';
import getBvAttendance from '../src/api/getBvAttendance';

test('a VDN Group member sees the enabled quiz and Bhakti Vriksha attendance', async t => {
  const user = {
    id: 'member-1',
    userId: 'USER-1',
    email: 'member@example.invalid',
    fullName: 'VDN Member',
    role: 'User',
    status: 'Active',
    isActive: true,
    segment: '',
    isPrabhupadaWorldUser: true,
    isBvMember: true,
    bvGroupId: 'BV-GROUP-VDN',
    bvGroupName: 'VDN Group',
  };
  const group = { id: 'BV-GROUP-VDN', groupId: 'BV-GROUP-VDN', groupName: 'VDN Group', isActive: true };
  const membership = { id: 'membership-1', memberId: user.email, group: group.id };
  const quiz = {
    id: 'quiz-1',
    department: 'PW',
    quizTitle: 'VDN quiz',
    isActive: true,
    activeGroupIds: [group.id],
    questionsJson: '[]',
  };
  const attendance = {
    id: 'att-1',
    group: group.id,
    user: membership.id,
    present: true,
    attendanceDate: '2026-10-01',
  };
  const fixtures: [any, any[]][] = [
    [Users, [user]],
    [Guides, []],
    [BvGroups, [group]],
    [BvGroupMembers, [membership]],
    [BvGroupRequests, []],
    [BvQuizzes, [quiz]],
    [BvQuizSubmissions, []],
    [BvAttendance, [attendance]],
    [FolkResidencies, []],
  ];
  for (const [table, rows] of fixtures) {
    const matches = (row: any, query: any = {}) => {
      if (query.id && row.id !== query.id) return false;
      return Object.entries(query.filters || {}).every(([key, value]: any) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.in)) {
          return value.in.includes(row[key]);
        }
        return row[key] === value;
      });
    };
    t.mock.method(table, 'findAll', async (query: any) => ({ records: rows.filter(row => matches(row, query)), hasMore: false }));
    t.mock.method(table, 'findOne', async (query: any) => rows.find(row => matches(row, query)));
  }

  // The signed-in API context carries no segment and no legacy PW flag.
  const context = { user: { id: user.id, userId: user.userId, email: user.email, fullName: user.fullName, role: 'User', status: 'Active', isActive: true } };
  const listed = await getMyBvQuizSubmissions.execute({ input: {}, context } as never);
  assert.deepEqual(listed.pendingQuizzes.map((item: any) => item.id), [quiz.id]);

  const status = await getUserBvStatus.execute({ input: {}, context } as never);
  assert.equal(status.myGroup?.groupName, 'VDN Group');
  assert.equal(status.presentCount, 1);
  assert.equal(status.totalSessions, 1);

  const history = await getBvAttendance.execute({
    input: { userId: user.userId, sinceDate: '2026-09-01' },
    context,
  } as never);
  assert.deepEqual(history.userHistory.map((row: any) => [row.attendanceDate, row.status]), [
    ['2026-10-01', 'P'],
  ]);
});
