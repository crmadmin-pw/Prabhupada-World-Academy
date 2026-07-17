import { z } from 'zod';
import { createEndpoint, ServiceAllocations, Services, ServiceRatings } from 'zite-integrations-backend-sdk';
import crypto from 'crypto';

export default createEndpoint({
  description: 'Get services that happened today with rating status for the end-of-day rating prompt',
  authenticated: true,
  inputSchema: z.object({
    date: z.string().optional(), // yyyy-MM-dd, defaults to today
  }),
  outputSchema: z.object({
    services: z.array(z.object({
      serviceId: z.string(),
      serviceName: z.string(),
      timeSlot: z.string(),
      hasRated: z.boolean(),
      avgRating: z.number().nullable(),
      ratingCount: z.number(),
    })),
    date: z.string(),
    isPastNinePm: z.boolean(),
  }),
  execute: async ({ input, context }) => {
    const today = input.date || new Date().toISOString().slice(0, 10);
    const now = new Date();
    const isPastNinePm = now.getHours() >= 21;

    // Find today's day of week for allocations
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = dayNames[new Date(today + 'T12:00:00').getDay()];

    // Get all allocations for today's date (any user, any service)
    const { records: allocs } = await ServiceAllocations.findAll({
      filters: { dayOfWeek: dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1) },
      fields: ['id', 'service', 'dayOfWeek', 'weekDate', 'status'],
      limit: 500,
    });

    // Filter to this week's allocations
    const weekDate = getWeekSunday(today);
    const todayAllocs = allocs.filter(a => {
      const wd = a.weekDate?.slice(0, 10) ?? '';
      return wd === weekDate;
    });

    // Get unique service IDs from today's allocations
    const serviceIds = [...new Set(
      todayAllocs.map(a => Array.isArray(a.service) ? a.service[0] : a.service).filter(Boolean) as string[]
    )];

    if (serviceIds.length === 0) {
      return { services: [], date: today, isPastNinePm };
    }

    // Get service details
    const { records: svcRecords } = await Services.findAll({
      filters: { id: { in: serviceIds } },
      fields: ['id', 'serviceName', 'timeSlot', 'isActive'],
    });

    // Get existing ratings for today
    const { records: ratings } = await ServiceRatings.findAll({
      filters: { ratingDate: today },
      fields: ['id', 'service', 'rating', 'raterHash'],
      limit: 2000,
    });

    // Build rating stats per service
    const ratingsByService = new Map<string, { sum: number; count: number }>();
    for (const r of ratings) {
      const svcId = Array.isArray(r.service) ? r.service[0] : r.service;
      if (!svcId) continue;
      const cur = ratingsByService.get(svcId) ?? { sum: 0, count: 0 };
      cur.sum += Number(r.rating ?? 0);
      cur.count += 1;
      ratingsByService.set(svcId, cur);
    }

    const result = svcRecords
      .filter(s => s.isActive !== false)
      .map(s => {
        // Check if this user has already rated this service today
        const raterHash = crypto
          .createHash('sha256')
          .update(`${context.user!.id}:${today}:${s.id}`)
          .digest('hex');
        const hasRated = ratings.some(r => r.raterHash === raterHash);
        const stats = ratingsByService.get(s.id);
        return {
          serviceId: s.id,
          serviceName: s.serviceName || '',
          timeSlot: s.timeSlot || '',
          hasRated,
          avgRating: stats && stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : null,
          ratingCount: stats?.count ?? 0,
        };
      });

    return { services: result, date: today, isPastNinePm };
  },
});

// Service week starts on Sunday
function getWeekSunday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}
