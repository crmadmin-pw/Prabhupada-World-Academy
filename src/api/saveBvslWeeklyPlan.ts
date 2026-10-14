import { z } from 'zod';
import { createEndpoint, BvslWeeklyPlans } from '@/lib/backend-sdk';
import { format, startOfWeek } from 'date-fns';

const STATUSES = ['White', 'Yellow', 'Green', 'Red'] as const;

const activitySchema = z.object({
  goal: z.string().optional().default(''),
  status: z.enum(STATUSES).optional().default('White'),
});

const daySchema = z.object({
  activities: z.array(activitySchema).max(12).optional(),
  goal1: z.string().optional().default(''),
  goal2: z.string().optional().default(''),
  status1: z.enum(STATUSES).optional().default('White'),
  status2: z.enum(STATUSES).optional().default('White'),
  /** Minutes spent on the day's activities. */
  duration: z.number().optional().default(0),
  reason: z.string().optional().default(''),
  success: z.string().optional().default(''),
});

function activitiesForDay(day: z.infer<typeof daySchema>) {
  const fromList = (day.activities || [])
    .map(activity => ({
      goal: activity.goal || '',
      status: activity.status || 'White',
    }))
    .slice(0, 12);
  if (fromList.length > 0) return fromList;
  return [
    { goal: day.goal1 || '', status: day.status1 || 'White' },
    { goal: day.goal2 || '', status: day.status2 || 'White' },
  ];
}

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
      const activities = activitiesForDay(day);
      const minutes = Math.max(0, Math.round(day.duration || 0));
      record[`${d}Goal1`] = activities[0]?.goal || '';
      record[`${d}Goal2`] = activities[1]?.goal || '';
      record[`${d}Status1`] = activities[0]?.status || 'White';
      record[`${d}Status2`] = activities[1]?.status || 'White';
      record[`${d}ActivitiesJson`] = JSON.stringify(activities);
      record[`${d}DurationMinutes`] = minutes;
      record[`${d}Duration`] = Math.round((minutes / 60) * 100) / 100;
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
