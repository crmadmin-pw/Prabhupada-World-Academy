import { z } from 'zod';
import { createEndpoint, BvslWeeklyPlans } from '@/lib/backend-sdk';

const activityOut = z.object({
  goal: z.string(),
  status: z.string(),
});

const dayOut = z.object({
  activities: z.array(activityOut),
  duration: z.number(),
  reason: z.string(),
  success: z.string(),
});

function readActivities(existing: any, day: string) {
  const raw = existing[`${day}ActivitiesJson`];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const activities = parsed.slice(0, 12).map((activity: any) => ({
          goal: String(activity?.goal || ''),
          status: String(activity?.status || 'White'),
        }));
        while (activities.length < 2) activities.push({ goal: '', status: 'White' });
        return activities;
      }
    } catch { /* fall back to the original two slots */ }
  }
  return [
    { goal: String(existing[`${day}Goal1`] || ''), status: String(existing[`${day}Status1`] || 'White') },
    { goal: String(existing[`${day}Goal2`] || ''), status: String(existing[`${day}Status2`] || 'White') },
  ];
}

function readMinutes(existing: any, day: string) {
  const stored = existing[`${day}DurationMinutes`];
  if (stored !== undefined && stored !== null && stored !== '') return Math.max(0, Math.round(Number(stored) || 0));
  return Math.max(0, Math.round((Number(existing[`${day}Duration`]) || 0) * 60));
}

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
        activities: readActivities(existing, d),
        duration: readMinutes(existing, d),
        reason: (existing as any)[`${d}Reason`] || '',
        success: (existing as any)[`${d}Success`] || '',
      };
    }

    return { plan };
  },
});
