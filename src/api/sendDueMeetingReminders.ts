import { z } from 'zod';
import { matchesAnySecret } from '@/lib/secretMatch';
import { createEndpoint, Meetings, AppError } from '@/lib/backend-sdk';
import { MEETING_REMINDERS, meetingStartMs, reminderWindow } from '@/lib/meetingReminderSchedule';
import { allReminderRecords } from '@/lib/meetingReminderRecipients';
import sendMeetingReminder from './sendMeetingReminder';

export default createEndpoint({
  description: 'Dispatch PW 10-minute and 1-minute meeting reminders. Called by Cloud Scheduler every minute.',
  public: true,
  inputSchema: z.object({ cronSecret: z.string().min(16).max(256) }),
  outputSchema: z.object({
    checked: z.number(), tenMinuteReminders: z.number(),
    oneMinuteReminders: z.number(), failed: z.number(),
  }),
  execute: async ({ input }: { input: any }) => {
    const secrets = [process.env.APP_CRON_SECRET, process.env.ZITE_CRON_SECRET].filter(Boolean);
    if (!matchesAnySecret(input.cronSecret, secrets)) throw new AppError({ code: 'UNAUTHORIZED', message: 'Unauthorized scheduler request' });
    const meetings = await allReminderRecords(Meetings);
    const now = Date.now();
    let checked = 0, oneMinuteReminders = 0, tenMinuteReminders = 0, failed = 0;
    const due: { meetingId: string; reminderType: 'ONE_MINUTE' | 'TEN_MINUTES' }[] = [];
    for (const meeting of meetings) {
      if (String(meeting.segment || 'PW').trim().toUpperCase() === 'FOLK') continue;
      if (String(meeting.status || 'SCHEDULED').toUpperCase() !== 'SCHEDULED') continue;
      const start = meetingStartMs(String(meeting.scheduledAt || ''));
      if (!Number.isFinite(start)) continue;
      checked++;
      for (const reminder of MEETING_REMINDERS) {
        const window = reminderWindow(start, reminder.type);
        if (meeting[reminder.sentField] || now < window.from || now >= window.until) continue;
        due.push({ meetingId: meeting.id, reminderType: reminder.type });
      }
    }
    for (let offset = 0; offset < due.length; offset += 5) {
      await Promise.all(due.slice(offset, offset + 5).map(async reminder => {
        try {
          const result = await sendMeetingReminder.execute({ input: { ...reminder, cronSecret: input.cronSecret }, context: {} } as never);
          if (!result.success) failed++;
          else if (reminder.reminderType === 'ONE_MINUTE') oneMinuteReminders++;
          else tenMinuteReminders++;
        } catch (error) {
          failed++;
          console.error(`[Meeting Reminder] ${reminder.meetingId} ${reminder.reminderType} failed:`, error);
        }
      }));
    }
    return { checked, tenMinuteReminders, oneMinuteReminders, failed };
  },
});
