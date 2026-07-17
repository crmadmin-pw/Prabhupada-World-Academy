import { z } from 'zod';
import { createEndpoint, Users, SadhanaEntries, Email } from 'zite-integrations-backend-sdk';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getISTDate(offsetDays = 0): string {
  return new Date(Date.now() + IST_OFFSET_MS + offsetDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

const ROUND_COPY = {
  1: {
    subject: '🙏 Gentle Reminder: Fill Your Sadhana Before Sleeping | FOLK',
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nA gentle reminder — you haven't filled your Sadhana for today yet.\n\nDevotees are expected to fill their Sadhana form before sleeping every night. Please take 2–3 minutes now while you still remember your day's practice. 🙏`,
    cta: "📿 Fill Today's Sadhana",
    footer: 'Hare Krishna! Your consistent practice matters greatly.',
  },
  2: {
    subject: "⏰ Missed Yesterday's Sadhana? Fill It Now | FOLK",
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nIt looks like you haven't filled your Sadhana form for yesterday.\n\nYou can still fill it now — please don't let it be missed completely. Even a late entry is better than no entry. 🙏`,
    cta: "📿 Fill Yesterday's Sadhana",
    footer: "Hare Krishna! It's not too late — please fill it now.",
  },
  3: {
    subject: "🚨 Final Reminder: Yesterday's Sadhana Not Yet Submitted | FOLK",
    body: (name: string) =>
      `Hare Krishna, ${name}!\n\nThis is your final reminder — yesterday's Sadhana has not been submitted yet.\n\nPlease take a moment to fill it right now. Your Folk Guide can see your entry history, and consistent submission reflects your sincere practice. 🙏`,
    cta: '📿 Fill Now — Last Chance',
    footer: "Hare Krishna! Please fill it now before the day gets any further.",
  },
} as const;

export default createEndpoint({
  description: 'Authenticated endpoint for Super Guides to manually trigger Sadhana reminder emails.',
  authenticated: true,
  inputSchema: z.object({
    round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  outputSchema: z.object({
    sent: z.number(),
    skipped: z.number(),
    date: z.string(),
    recipients: z.array(z.object({ name: z.string(), email: z.string() })),
  }),
  execute: async ({ input, context }) => {
    // Only Super Guides can trigger reminders
    if (context.user!.role !== 'Super Guide') {
      throw new Error('Unauthorised: Super Guide role required');
    }

    const targetDate = input.round === 1 ? getISTDate(0) : getISTDate(-1);
    const copy = ROUND_COPY[input.round];
    const sadhanaUrl = `${process.env.ZITE_APP_URL ?? ''}/sadhana`;

    // Collect all active users with emails
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

    if (activeUsers.length === 0) return { sent: 0, skipped: 0, date: targetDate, recipients: [] };

    // Fetch existing entries for targetDate
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

    const needsReminder = activeUsers.filter(u => !existingEntries.has(u.id));
    let sent = 0;
    let skipped = 0;
    const recipients: { name: string; email: string }[] = [];

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
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') {
          sent++;
          recipients.push({ name: batch[idx].fullName, email: batch[idx].email });
        } else {
          skipped++;
        }
      });
    }

    return { sent, skipped, date: targetDate, recipients };
  },
});
