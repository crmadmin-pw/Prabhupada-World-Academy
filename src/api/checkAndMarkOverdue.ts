import { z } from 'zod';
import { createEndpoint, ServiceAllocations } from 'zite-integrations-backend-sdk';
import { getTodayIST } from '../lib/streakUtils';

export default createEndpoint({
  description: 'Check and mark overdue service allocations',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const todayStr = getTodayIST();
    const uid = context.user!.id;

    // Only check this user's allocations up to today
    const res = await ServiceAllocations.findAll({
      filters: { user: uid, status: 'Scheduled', weekDate: { lt: new Date(todayStr) } },
      limit: 50,
      fields: ['id', 'status', 'weekDate', 'dayOfWeek'],
    });

    // Sunday is offset 0 (week start)
    const DAY_OFFSETS: Record<string, number> = {
      Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
    };

    let overdueCount = 0;
    for (const a of res.records) {
      const weekDate = a.weekDate;
      if (!weekDate) continue;
      const offset = DAY_OFFSETS[a.dayOfWeek || ''] ?? 0;
      const d = new Date(weekDate + 'T00:00:00');
      d.setDate(d.getDate() + offset);
      const dateStr = d.toISOString().split('T')[0];
      if (dateStr < todayStr) {
        await ServiceAllocations.update({ id: a.id, record: { status: 'Overdue' } });
        overdueCount++;
      }
    }

    return { overdueCount, success: true };
  },
});
