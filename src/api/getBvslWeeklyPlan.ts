import { z } from 'zod';
import { createEndpoint, BvslWeeklyPlans } from 'zite-integrations-backend-sdk';

const dayOut = z.object({
  goal1: z.string(), goal2: z.string(),
  status1: z.string(), status2: z.string(),
  duration: z.number(), reason: z.string(), success: z.string(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Get a BVSL weekly plan for a given week',
  inputSchema: z.object({
    weekStart: z.string(),
    userId: z.string().optional(),
  }),
  outputSchema: z.object({
    plan: z.object({
      id: z.string(),
      weekLabel: z.string(),
      weekStart: z.string(),
      mon: dayOut, tue: dayOut, wed: dayOut, thu: dayOut,
      fri: dayOut, sat: dayOut, sun: dayOut,
    }).nullable(),
  }),
  async execute({ input, context }) {
    const targetUserId = input.userId || context.user.id;

    const existing = await BvslWeeklyPlans.findOne({
      filters: { user: targetUserId, weekStart: input.weekStart },
    });

    if (!existing) return { plan: null };

    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
    const plan: any = {
      id: existing.id,
      weekLabel: existing.weekLabel || '',
      weekStart: existing.weekStart || input.weekStart,
    };

    for (const d of days) {
      plan[d] = {
        goal1: (existing as any)[`${d}Goal1`] || '',
        goal2: (existing as any)[`${d}Goal2`] || '',
        status1: (existing as any)[`${d}Status1`] || 'White',
        status2: (existing as any)[`${d}Status2`] || 'White',
        duration: (existing as any)[`${d}Duration`] || 0,
        reason: (existing as any)[`${d}Reason`] || '',
        success: (existing as any)[`${d}Success`] || '',
      };
    }

    return { plan };
  },
});
