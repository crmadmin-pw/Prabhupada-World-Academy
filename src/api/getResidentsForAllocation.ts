import { z } from 'zod';
import { createEndpoint, Users, FolkResidencies, ServiceAvailability } from 'zite-integrations-backend-sdk';

function parseAvailDays(json: string): { day: string; time: string }[] {
  try {
    const p = JSON.parse(json ?? '[]');
    if (!Array.isArray(p) || p.length === 0) return [];
    if (typeof p[0] === 'string') return p.map((d: string) => ({ day: d, time: 'full_day' }));
    return p.map((d: any) => ({ day: d.day, time: d.time ?? 'full_day' }));
  } catch { return []; }
}

export default createEndpoint({
  description: 'Get residents available for service allocation, with merged availability data',
  authenticated: true,
  inputSchema: z.object({
    residencyId: z.string().optional(),
    weekStartDate: z.string().optional(),
  }),
  outputSchema: z.any(),
  execute: async ({ input }) => {
    const filter: any = { residencyApproved: true, status: 'Active' };

    if (input.residencyId) {
      const residency = await FolkResidencies.findOne({
        filters: { residencyId: input.residencyId },
        fields: ['id'],
      });
      if (residency) {
        filter.residency = residency.id;
      } else {
        return { residents: [] };
      }
    }

    const { records } = await Users.findAll({
      filters: filter,
      fields: ['id', 'userId', 'fullName', 'phone', 'residency'],
      limit: 500,
    });

    // Fetch availability for the given week
    const availMap: Record<string, Record<string, string>> = {};
    const weekStartDate = input.weekStartDate;
    if (weekStartDate && records.length > 0) {
      const userIds = records.map((u: any) => u.id);
      // Fetch in batches if large
      const avRes = await ServiceAvailability.findAll({
        filters: { weekDate: weekStartDate },
        limit: 500,
      });
      for (const avRec of avRes.records) {
        const uid = Array.isArray(avRec.user) ? avRec.user[0] : avRec.user;
        if (!uid || !userIds.includes(uid)) continue;
        const days = parseAvailDays(avRec.availableDaysJson || '[]');
        availMap[uid] = {};
        for (const d of days) {
          availMap[uid][d.day] = d.time;
        }
      }
    }

    return {
      residents: records.map((u: any) => ({
        userId: (u.userId as string) || u.id,
        dbId: u.id,
        userName: (u.fullName as string) || '',
        fullName: (u.fullName as string) || '',
        phone: u.phone || '',
        residencyId: Array.isArray(u.residency) ? u.residency[0] : (u.residency as string) || null,
        dayAvailability: availMap[u.id] ?? {},
      })),
    };
  },
});
