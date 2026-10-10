import { apiUser } from './helpers/apiUser';
import assert from 'node:assert/strict';
import test from 'node:test';
import createMeeting from '../src/api/createMeeting';
import updateMeeting from '../src/api/updateMeeting';
import { Meetings, Users } from '../src/lib/app-backend-sdk';

const adminContext = {
  user: apiUser({
    id: 'admin-1',
    fullName: 'Admin User',
    email: 'admin@example.invalid',
    role: 'PW_ADMIN',
    segment: 'PW',
    isBvAdmin: true,
  }),
};

test('facilitator meeting creation saves only the selected participants', async t => {
  const selectedUsers = [
    { id: 'rgf-1', fullName: 'Selected RGF', email: 'rgf@example.invalid', role: 'RGF' },
    { id: 'supervisor-1', fullName: 'Selected Supervisor', email: 'supervisor@example.invalid', role: 'SUPERVISOR' },
  ];
  let savedRecord: any;

  t.mock.method(Users, 'findAll', async (query: any) => {
    assert.deepEqual(query.filters.id.in, ['rgf-1', 'supervisor-1']);
    return { records: selectedUsers, hasMore: false };
  });
  t.mock.method(Meetings, 'create', async ({ record }: any) => {
    savedRecord = record;
    return { id: 'meeting-1' };
  });

  await createMeeting.execute({
    input: {
      title: 'Facilitators Meeting',
      type: 'FACILITATOR',
      scheduledAt: '2099-09-09T10:00:00.000Z',
      durationMinutes: 60,
      locationOrLink: 'https://meet.google.com/example',
      description: '',
      notificationLeadMinutes: 10,
      additionalInviteeIds: ['rgf-1', 'supervisor-1', 'rgf-1'],
    },
    context: adminContext,
  });

  assert.deepEqual(savedRecord.inviteeUserIds, ['rgf-1', 'supervisor-1']);
  assert.deepEqual(savedRecord.invitees.map((person: any) => person.userId), ['rgf-1', 'supervisor-1']);
});

test('creating a meeting rejects a start time that has already passed', async () => {
  await assert.rejects(() => createMeeting.execute({
    input: {
      title: 'Too late',
      type: 'OTHER',
      scheduledAt: '2026-10-10T16:00',
      durationMinutes: 60,
      locationOrLink: '',
      description: '',
      notificationLeadMinutes: 10,
      additionalInviteeIds: [],
    },
    context: adminContext,
  }), /already passed/);
});

test('editing a facilitator meeting replaces participants with the selected list', async t => {
  let updatedRecord: any;
  t.mock.method(Meetings, 'findOne', async () => ({
    id: 'meeting-1',
    type: 'FACILITATOR',
    inviteeUserIds: ['old-1', 'old-2'],
    scheduledAt: '2026-09-09T10:00:00.000Z',
  }));
  t.mock.method(Users, 'findAll', async (query: any) => {
    assert.deepEqual(query.filters.id.in, ['rgf-1']);
    return {
      records: [{ id: 'rgf-1', fullName: 'Selected RGF', email: 'rgf@example.invalid', role: 'RGF' }],
      hasMore: false,
    };
  });
  t.mock.method(Meetings, 'update', async ({ record }: any) => {
    updatedRecord = record;
    return { id: 'meeting-1' };
  });

  await updateMeeting.execute({
    input: {
      status: undefined,
      meetingId: 'meeting-1',
      type: 'FACILITATOR',
      additionalInviteeIds: ['rgf-1'],
      sendReminderNow: false,
    },
    context: adminContext,
  });

  assert.deepEqual(updatedRecord.inviteeUserIds, ['rgf-1']);
  assert.deepEqual(updatedRecord.invitees.map((person: any) => person.userId), ['rgf-1']);
});

test('meeting edits validate and persist duration without resetting scheduled reminders', async t => {
  let updatedRecord: any;
  t.mock.method(Meetings, 'findOne', async () => ({
    id: 'meeting-1', segment: 'PW', durationMinutes: 60,
    scheduledAt: '2026-09-09T10:00:00.000Z', notification10mSent: true,
  }));
  t.mock.method(Meetings, 'update', async ({ record }: any) => {
    updatedRecord = record;
    return { id: 'meeting-1' };
  });
  const input = updateMeeting.inputSchema.parse({ meetingId: 'meeting-1', durationMinutes: 90 });
  await updateMeeting.execute({ input, context: adminContext });
  assert.equal(updatedRecord.durationMinutes, 90);
  assert.equal(Object.hasOwn(updatedRecord, 'notification10mSent'), false);
  assert.equal(Object.hasOwn(updatedRecord, 'inviteeUserIds'), false);
  assert.equal(updateMeeting.inputSchema.safeParse({ meetingId: 'meeting-1', durationMinutes: 0 }).success, false);
});

test('editing a meeting preserves every participant beyond the Firestore 30-value query limit', async t => {
  const ids = Array.from({ length: 67 }, (_, index) => `participant-${index}`);
  let saved: any;
  const batchSizes: number[] = [];
  t.mock.method(Meetings, 'findOne', async () => ({ id: 'large-meeting', segment: 'PW', inviteeUserIds: [] }));
  t.mock.method(Users, 'findAll', async ({ filters }: any) => {
    const batch = filters.id.in;
    batchSizes.push(batch.length);
    assert.ok(batch.length <= 30);
    return { records: batch.map((id: string) => ({ id, fullName: id, email: `${id}@example.invalid` })), hasMore: false };
  });
  t.mock.method(Meetings, 'update', async ({ record }: any) => { saved = record; return { id: 'large-meeting' }; });
  await updateMeeting.execute({ input: { meetingId: 'large-meeting', additionalInviteeIds: ids }, context: adminContext } as never);
  assert.deepEqual(batchSizes, [30, 30, 7]);
  assert.deepEqual(saved.invitees.map((person: any) => person.userId), ids);
  assert.equal(saved.notification1mSent, false);
  assert.equal(saved.notification10mSent, false);
});
