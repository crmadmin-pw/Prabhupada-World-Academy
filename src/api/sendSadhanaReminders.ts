import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, Email } from 'zite-integrations-backend-sdk';

/**
 * SADHANA REMINDER SCHEDULER
 * ──────────────────────────
 * This endpoint is called by an external cron/scheduler at 3 fixed times (IST):
 *
 *   Round 1 → 9:00 PM IST   (same day)   → "Don't forget to fill before sleeping"
 *   Round 2 → 4:45 AM IST   (next day)   → "You missed yesterday — please fill now"
 *   Round 3 → 9:15 AM IST   (next day)   → "Final reminder — last chance for yesterday"
 *
 * HOW TO SCHEDULE (using any cron service, e.g. cron-job.org, EasyCron, Pipedream):
 *   POST  <your-app-url>/api/sendSadhanaReminders
 *   Body: { "secret": "<ZITE_REMINDER_SECRET>", "round": 1 }
 *
 * UTC times (IST = UTC+5:30):
 *   Round 1 → 15:30 UTC   (9:00 PM IST)
 *   Round 2 → 23:15 UTC   (4:45 AM IST next day)
 *   Round 3 → 03:45 UTC   (9:15 AM IST next day)
 *
 * Set ZITE_REMINDER_SECRET in your app secrets to protect this endpoint.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTDate(offsetDays = 0): string {
  return new Date(Date.now() + IST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

const ROUND_COPY = {
  1: {
    subject: '🙏 Gentle Reminder: Fill Your Sadhana Before Sleeping | FOLK',
    heading: 'Time to fill your Sadhana, Prabhu!',
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nA gentle reminder — you haven't filled your Sadhana for today yet.\n\nDevotees are expected to fill their Sadhana form before sleeping every night. Please take 2–3 minutes now while you still remember your day's practice. 🙏`,
    cta: '📿 Fill Today\'s Sadhana',
    footer: 'Hare Krishna! Your consistent practice matters greatly.',
  },
  2: {
    subject: '⏰ Missed Yesterday\'s Sadhana? Fill It Now | FOLK',
    heading: 'You missed yesterday\'s Sadhana entry',
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nIt looks like you haven't filled your Sadhana form for <strong>yesterday</strong>.\n\nYou can still fill it now — please don't let it be missed completely. Even a late entry is better than no entry. 🙏`,
    cta: '📿 Fill Yesterday\'s Sadhana',
    footer: `Hare Krishna! It's not too late — please fill it now.`,
  },
  3: {
    subject: '🚨 Final Reminder: Yesterday\'s Sadhana Not Yet Submitted | FOLK',
    heading: 'Last chance — yesterday\'s Sadhana is still missing',
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nThis is your <strong>final reminder</strong> — yesterday's Sadhana has not been submitted yet.\n\nPlease take a moment to fill it right now. Your Folk Guide can see your entry history, and consistent submission reflects your sincere practice. 🙏`,
    cta: '📿 Fill Now — Last Chance',
    footer: `Hare Krishna! Please fill it now before the day gets any further.`,
  },
} as const;

export default createEndpoint({
  description: 'Send Sadhana reminders to active users who have not submitted for the relevant date. Called by external cron at 9 PM, 4:45 AM, and 9:15 AM IST.',
  inputSchema: z.object({
    secret: z.string().min(1),
    round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  outputSchema: z.object({
    sent: z.number(),
    skipped: z.number(),
    date: z.string(),
  }),
  execute: async ({ input }) => {
    // Verify secret to prevent unauthorised calls
    const expectedSecret = process.env.ZITE_REMINDER_SECRET ?? '';
    if (!expectedSecret || input.secret !== expectedSecret) {
      // Return silently — don't reveal whether the secret is wrong
      return { sent: 0, skipped: 0, date: '' };
    }

    // Round 1 = check today's entry; rounds 2 & 3 = check yesterday's entry
    const targetDate = input.round === 1 ? getISTDate(0) : getISTDate(-1);
    const copy = ROUND_COPY[input.round];
    const appUrl = process.env.ZITE_APP_URL ?? '';
    const sadhanaUrl = `${appUrl}/sadhana`;

    // Collect all active users with emails (paginated)
    const activeUsers: { id: string; email: string; fullName: string }[] = [];
    let offset = 0;
    while (true) {
      const { records, hasMore } = await Users.findAll({
        filters: { status: 'Active' },
        fields: ['id', 'email', 'fullName'],
        limit: 500,
        offset,
      });
      for (const u of records) {
        if (u.email && u.id) {
          activeUsers.push({ id: u.id, email: u.email, fullName: u.fullName ?? 'Prabhu' });
        }
      }
      if (!hasMore) break;
      offset += records.length;
    }

    if (activeUsers.length === 0) return { sent: 0, skipped: 0, date: targetDate };

    // Fetch all entries for targetDate in one query to avoid N+1
    const userIds = activeUsers.map(u => u.id);
    const existingEntries = new Set<string>();
    let entryOffset = 0;
    while (true) {
      const { records: entries, hasMore } = await SadhanaEntries.findAll({
        filters: { entryDate: targetDate },
        fields: ['id', 'user'],
        limit: 500,
        offset: entryOffset,
      });
      for (const e of entries) {
        const uid = Array.isArray(e.user) ? e.user[0] : e.user;
        if (uid) existingEntries.add(uid);
      }
      if (!hasMore) break;
      entryOffset += entries.length;
    }

    // Send emails only to users who haven't submitted — process in batches of 10
    let sent = 0;
    let skipped = 0;
    const needsReminder = activeUsers.filter(u => !existingEntries.has(u.id));

    const BATCH_SIZE = 10;
    for (let i = 0; i < needsReminder.length; i += BATCH_SIZE) {
      const batch = needsReminder.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(user =>
          Email.send({
            to: user.email,
            subject: copy.subject,
            body: [
              { type: 'text', content: copy.body(user.fullName) },
              { type: 'button', label: copy.cta, href: sadhanaUrl, alignment: 'center' },
              { type: 'divider' },
              { type: 'text', content: copy.footer },
            ],
          })
        )
      );
      for (const r of results) {
        if (r.status === 'fulfilled') sent++;
        else skipped++;
      }
    }

    return { sent, skipped, date: targetDate };
  },
});
