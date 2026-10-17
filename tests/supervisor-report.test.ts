import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/lib/app-backend-sdk';
import getBvSupervisorReport from '../src/api/getBvSupervisorReport';
import { getTodayIST } from '../src/lib/streakUtils';

const admin = { id: 'report-admin', userId: 'ADMIN-1', role: 'ADMIN', isBvAdmin: true, status: 'Active' };
const member = { id: 'report-member', userId: 'MEMBER-1', role: 'USER', status: 'Active' };
const supervisor = {
  id: 'report-supervisor',
  userId: 'SUP-1',
  fullName: 'Madhava Supervisor',
  status: 'Active',
  isBvSupervisor: true,
};
const otherSupervisor = {
  id: 'report-other-supervisor',
  userId: 'SUP-2',
  fullName: 'Other Supervisor',
  status: 'Active',
  isBvSupervisor: true,
};

function isoWeekStart(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const today = getTodayIST();
const currentMonday = isoWeekStart(today);
const recentMonday = addDays(currentMonday, -7);
const olderMonday = addDays(currentMonday, -21);

const pwGroup = {
  id: 'report-group',
  groupId: 'REPORT-GROUP',
  groupName: 'Govinda Reading',
  segment: 'PW',
  isActive: true,
  supervisorId: supervisor.id,
  supervisorUserId: supervisor.userId,
  supervisorName: supervisor.fullName,
};
const folkGroup = {
  id: 'folk-group',
  groupId: 'FOLK-GROUP',
  groupName: 'Folk Reading',
  segment: 'FOLK',
  isActive: true,
  supervisorId: otherSupervisor.id,
  supervisorName: otherSupervisor.fullName,
};

function mockDatabase(t: any) {
  const fixture: Record<string, any[]> = {
    Users: [admin, member, supervisor, otherSupervisor],
    BvGroups: [pwGroup, folkGroup],
    BvAttendance: [
      {
        id: 'older-member',
        group: pwGroup.id,
        user: member.id,
        present: true,
        attendedMinutes: 60,
        totalMeetingMinutes: 60,
        attendanceDate: olderMonday,
      },
      {
        id: 'older-supervisor',
        group: pwGroup.id,
        user: supervisor.id,
        present: true,
        attendedMinutes: 25,
        totalMeetingMinutes: 60,
        attendanceDate: olderMonday,
      },
      {
        id: 'recent-member',
        group: pwGroup.id,
        user: member.id,
        present: true,
        attendedMinutes: 40,
        totalMeetingMinutes: 40,
        attendanceDate: recentMonday,
      },
    ],
    BvSessions: [
      { id: 'older-session', group: pwGroup.id, sessionDate: olderMonday },
      { id: 'recent-session', group: pwGroup.id, sessionDate: recentMonday },
    ],
  };
  const matches = (record: any, filters: any) => Object.entries(filters || {}).every(([field, value]: any) => {
    const actual = record[field];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.in) return [actual].flat().some(item => value.in.includes(item));
      return true;
    }
    return [actual].flat().includes(value);
  });
  for (const [name, table] of Object.entries(sdk) as [string, any][]) {
    if (typeof table?.findAll !== 'function') continue;
    t.mock.method(table, 'findAll', async (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      return { records, hasMore: false };
    });
    t.mock.method(table, 'findOne', async (options: any = {}) => {
      let records = (fixture[name] || []).filter(record => matches(record, options.filters));
      if (options.id) records = records.filter(record => record.id === options.id);
      return records[0];
    });
  }
}

test('an admin sees every reading group and the supervisor minutes for past and current weeks', async (t) => {
  mockDatabase(t);
  const listed = await getBvSupervisorReport.execute({
    input: { segment: 'PW' },
    context: { user: admin },
  } as never);
  assert.deepEqual(listed.groups.map((group: any) => group.groupName), ['Govinda Reading']);
  assert.deepEqual(listed.groups[0].supervisorNames, ['Madhava Supervisor']);
  assert.equal(listed.report, null);

  const detail = await getBvSupervisorReport.execute({
    input: { segment: 'PW', groupId: pwGroup.id },
    context: { user: admin },
  } as never);
  const weeks = detail.report.weeks;
  assert.equal(weeks[0].current, true);
  assert.equal(weeks[0].weekStart, currentMonday);
  assert.equal(weeks.at(-1).weekStart, olderMonday);

  const gap = weeks.find((week: any) => week.weekStart === addDays(currentMonday, -14));
  assert.equal(gap.sessions.length, 0);
  assert.equal(gap.supervisors[0].status, 'no_session');

  const recent = weeks.find((week: any) => week.weekStart === recentMonday);
  assert.equal(recent.supervisors[0].visits, 0);
  assert.equal(recent.supervisors[0].status, 'short');
  assert.equal(recent.sessions[0].supervisors[0].joined, false);
  assert.equal(recent.sessions[0].supervisors[0].attendedMinutes, 0);
  assert.equal(recent.sessions[0].totalMinutes, 40);

  const older = weeks.find((week: any) => week.weekStart === olderMonday);
  assert.equal(older.supervisors[0].visits, 1);
  assert.equal(older.supervisors[0].expectedVisits, 2);
  assert.equal(older.supervisors[0].status, 'short');
  assert.equal(older.sessions[0].supervisors[0].joined, true);
  assert.equal(older.sessions[0].supervisors[0].attendedMinutes, 25);
  assert.equal(older.sessions[0].totalMinutes, 60);
});

test('a reading group member cannot open the supervisor report', async (t) => {
  mockDatabase(t);
  await assert.rejects(
    () => getBvSupervisorReport.execute({
      input: { segment: 'PW' },
      context: { user: member },
    } as never),
    (error: any) => error.code === 'FORBIDDEN',
  );
});
