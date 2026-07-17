import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services, Users, Email } from 'zite-integrations-backend-sdk';
import { getServiceWeekStartOf } from '../lib/serviceWeek';

/**
 * SERVICE REMINDER SCHEDULER
 * ──────────────────────────
 * This endpoint is called by an external cron/scheduler at 2 times (IST):
 *
 *   Round 1 → 9:00 PM IST    → "Your service is still pending — please mark it done"
 *   Round 2 → 10:30 PM IST   → "Final reminder — service still not marked done"
 *
 * HOW TO SCHEDULE (using any cron service, e.g. cron-job.org, EasyCron, Pipedream):
 *   POST  <your-app-url>/api/sendServiceReminders
 *   Body: { "secret": "<ZITE_REMINDER_SECRET>", "round": 1 }
 *
 * UTC times (IST = UTC+5:30):
 *   Round 1 → 15:30 UTC   (9:00 PM IST)
 *   Round 2 → 17:00 UTC   (10:30 PM IST)
 *
 * Use the same ZITE_REMINDER_SECRET as the sadhana reminders.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTDateString(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0];
}

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ROUND_COPY = {
  1: {
    subject: '⏰ Pending Service Reminder | FOLK',
    heading: (name: string) => `Hare Krishna, ${name}! Your service(s) are still pending.`,
    intro: (name: string) =>
      `Hare Krishna, ${name}!\n\nA gentle reminder — the following service(s) assigned to you today are still pending (not yet marked as Done):`,
    closing:
      'Please open the app and mark each service as Done once completed. If you are unable to complete a service, please request a swap so that another devotee can step in. 🙏',
    cta: '✅ Mark Services Done',
    footer: 'Hare Krishna! Your service is an offering to Krishna — please complete and mark it done.',
  },
  2: {
    subject: '🚨 Final Reminder: Services Still Pending | FOLK',
    heading: (name: string) => `Hare Krishna, ${name}! Final reminder — services still not marked done.`,
    intro: (name: string) =>
      `Hare Krishna, ${name}!\n\nThis is your <strong>final reminder</strong> for today — the following service(s) are still not marked as Done:`,
    closing:
      'If you have already completed the service(s), please open the app and mark them as Done immediately. If you were unable to complete a service, please request a swap so another devotee is aware and can step in. 🙏',
    cta: '✅ Mark Services Done Now',
    footer: `Hare Krishna! Services not marked done will be recorded as Overdue. Please act now.`,
  },
} as const;

export default createEndpoint({
  description:
    'Send email reminders to residents who have pending (unmarked) service allocations for today. Called by external cron at 9 PM and 10:30 PM IST.',
  inputSchema: z.object({
    secret: z.string().min(1),
    round: z.union([z.literal(1), z.literal(2)]),
  }),
  outputSchema: z.object({
    sent: z.number(),
    skipped: z.number(),
    date: z.string(),
  }),
  execute: async ({ input }) => {
    // Verify secret
    const expectedSecret = process.env.ZITE_REMINDER_SECRET ?? '';
    if (!expectedSecret || input.secret !== expectedSecret) {
      return { sent: 0, skipped: 0, date: '' };
    }

    const todayStr = getISTDateString();
    const todayDate = new Date(todayStr + 'T12:00:00');
    const todayDayName = FULL_DAY_NAMES[todayDate.getDay()]; // e.g. "Monday"
    const weekStartSunday = getServiceWeekStartOf(todayDate); // Sunday of this service week

    const copy = ROUND_COPY[input.round];
    const appUrl = process.env.ZITE_APP_URL ?? '';

    // 1. Fetch all Scheduled allocations for today (this service week + today's day of week)
    const { records: allocs } = await ServiceAllocations.findAll({
      filters: {
        weekDate: weekStartSunday,
        dayOfWeek: todayDayName,
        status: 'Scheduled',
      },
      fields: ['id', 'user', 'service'],
      limit: 500,
    });

    if (allocs.length === 0) {
      return { sent: 0, skipped: 0, date: todayStr };
    }

    // 2. Resolve unique service IDs and user IDs
    const serviceIds = [...new Set(
      allocs.map(a => (Array.isArray(a.service) ? a.service[0] : a.service)).filter(Boolean) as string[]
    )];
    const userIds = [...new Set(
      allocs.map(a => (Array.isArray(a.user) ? a.user[0] : a.user)).filter(Boolean) as string[]
    )];

    if (userIds.length === 0) return { sent: 0, skipped: 0, date: todayStr };

    // 3. Fetch service details
    const serviceMap = new Map<string, { name: string; timeSlot: string }>();
    if (serviceIds.length > 0) {
      const { records: svcRecords } = await Services.findAll({
        filters: { id: { in: serviceIds } },
        fields: ['id', 'serviceName', 'timeSlot'],
        limit: 200,
      });
      for (const s of svcRecords) {
        serviceMap.set(s.id, { name: s.serviceName || '', timeSlot: s.timeSlot || '' });
      }
    }

    // 4. Fetch user details (name + email)
    const userMap = new Map<string, { fullName: string; email: string }>();
    {
      const { records: userRecords } = await Users.findAll({
        filters: { id: { in: userIds } },
        fields: ['id', 'fullName', 'email'],
        limit: 500,
      });
      for (const u of userRecords) {
        if (u.email) {
          userMap.set(u.id, { fullName: u.fullName || 'Prabhu', email: u.email });
        }
      }
    }

    // 5. Group pending allocations by user
    const userPendingServices = new Map<string, { name: string; timeSlot: string }[]>();
    for (const a of allocs) {
      const userId = (Array.isArray(a.user) ? a.user[0] : a.user) as string | undefined;
      const serviceId = (Array.isArray(a.service) ? a.service[0] : a.service) as string | undefined;
      if (!userId || !serviceId) continue;
      if (!userMap.has(userId)) continue; // no email on file — skip

      const svc = serviceMap.get(serviceId);
      if (!svc) continue;

      if (!userPendingServices.has(userId)) userPendingServices.set(userId, []);
      userPendingServices.get(userId)!.push(svc);
    }

    // 6. Send one email per user listing all their pending services
    let sent = 0;
    let skipped = 0;

    for (const [userId, services] of userPendingServices) {
      const user = userMap.get(userId)!;
      const serviceListText = services
        .map(s => `• ${s.name}${s.timeSlot ? ` (${s.timeSlot})` : ''}`)
        .join('\n');
      const serviceListHtml = services
        .map(s => `<strong>${s.name}</strong>${s.timeSlot ? ` — ${s.timeSlot}` : ''}`)
        .join('<br/>');

      try {
        await Email.send({
          to: user.email,
          subject: copy.subject,
          body: [
            {
              type: 'text',
              content: `${copy.intro(user.fullName)}\n\n${serviceListText}\n\n${copy.closing}`,
            },
            {
              type: 'button',
              label: copy.cta,
              href: appUrl,
              alignment: 'center',
            },
            { type: 'divider' },
            {
              type: 'text',
              content: copy.footer,
            },
          ],
        });
        sent++;
      } catch {
        skipped++;
      }
    }

    return { sent, skipped, date: todayStr };
  },
});
