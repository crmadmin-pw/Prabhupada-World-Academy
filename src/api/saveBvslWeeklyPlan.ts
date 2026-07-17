import { z } from 'zod';
import { createEndpoint, BvslWeeklyPlans } from 'zite-integrations-backend-sdk';
import { format, startOfWeek } from 'date-fns';

const daySchema = z.object({
  goal1: z.string().optional().default(''),
  goal2: z.string().optional().default(''),
  status1: z.enum(['White', 'Yellow', 'Green', 'Red']).optional().default('White'),
  status2: z.enum(['White', 'Yellow', 'Green', 'Red']).optional().default('White'),
  duration: z.number().optional().default(0),
  reason: z.string().optional().default(''),
  success: z.string().optional().default(''),
});

export default createEndpoint({
  authenticated: true,
  description: 'Save or update a BVSL weekly preaching plan',
  inputSchema: z.object({
    weekStart: z.string(),
    mon: daySchema, tue: daySchema, wed: daySchema, thu: daySchema,
    fri: daySchema, sat: daySchema, sun: daySchema,
  }),
  outputSchema: z.object({ id: z.string(), saved: z.boolean() }),
  async execute({ input, context }) {
    const userId = context.user.id;
    const ws = input.weekStart;

    // Build week label from weekStart
    const startDate = new Date(ws + 'T00:00:00');
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const weekLabel = `${format(startDate, 'd MMM')} - ${format(endDate, 'd MMM yyyy')}`;

    const record: any = {
      weekLabel,
      user: [userId],
      weekStart: ws,
    };

    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
    for (const d of days) {
      const day = input[d];
      record[`${d}Goal1`] = day.goal1;
      record[`${d}Goal2`] = day.goal2;
      record[`${d}Status1`] = day.status1;
      record[`${d}Status2`] = day.status2;
      record[`${d}Duration`] = day.duration;
      record[`${d}Reason`] = day.reason;
      record[`${d}Success`] = day.success;
    }

    // Check if plan exists for this user + week
    const existing = await BvslWeeklyPlans.findOne({
      filters: { user: userId, weekStart: ws },
    });

    if (existing) {
      await BvslWeeklyPlans.update({ id: existing.id, record });
      return { id: existing.id, saved: true };
    } else {
      const created = await BvslWeeklyPlans.create({ record });
      return { id: created.id, saved: true };
    }
  },
});
