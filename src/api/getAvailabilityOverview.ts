import { z } from 'zod';
import { createEndpoint, ServiceAvailability, Users } from 'zite-integrations-backend-sdk';

function parseAvailDays(json: string): { day: string; time: string }[] {
  try {
    const p = JSON.parse(json ?? '[]');
    if (!Array.isArray(p) || p.length === 0) return [];
    if (typeof p[0] === 'string') return p.map((d: string) => ({ day: d, time: 'full_day' }));
    return p.map((d: any) => ({ day: d.day, time: d.time ?? 'full_day' }));
  } catch { return []; }
}

export default createEndpoint({
  description: 'Get availability overview for a week (guide view)',
  authenticated: true,
  inputSchema: z.object({ weekStartDate: z.string().optional(), residencyId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ input, context }) => {
    const today = new Date();
    const sun = new Date(today); sun.setDate(today.getDate() - today.getDay());
    const weekStartDate = input.weekStartDate || sun.toISOString().split('T')[0];

    const avRes = await ServiceAvailability.findAll({ filters: { weekDate: weekStartDate }, limit: 500 });
    const userIds = avRes.records.map(a => Array.isArray(a.user) ? a.user[0] : a.user).filter(Boolean) as string[];

    // Fetch guide's users for "not submitted" list
    let allResidentIds: string[] = [];
    const userMap: Record<string, { fullName: string; userId: string }> = {};

    if (userIds.length > 0) {
      const usersRes = await Users.findAll({
        filters: { id: { in: userIds } as any },
        fields: ['id', 'fullName', 'userId'],
      });
      usersRes.records.forEach(u => {
        userMap[u.id] = { fullName: u.fullName || '', userId: u.id };
      });
    }

    // Try to find all active residents (under this guide)
    try {
      const allRes = await Users.findAll({
        filters: { status: 'Active', residencyApproved: true },
        fields: ['id', 'fullName', 'userId', 'residency'],
        limit: 1000,
      });
      allResidentIds = allRes.records
        .filter(u => {
          const res = u.residency;
          return Array.isArray(res) ? res.length > 0 : !!res;
        })
        .map(u => {
          userMap[u.id] = { fullName: u.fullName || '', userId: u.id };
          return u.id;
        });
    } catch { /* optional */ }

    const submittedUserIds = new Set(userIds);
    const notSubmittedIds = allResidentIds.filter(id => !submittedUserIds.has(id));

    const submitted = avRes.records.map(a => {
      const uid = Array.isArray(a.user) ? a.user[0] : a.user;
      const dayDetails = parseAvailDays(a.availableDaysJson || '[]');
      return {
        userId: uid || '',
        userName: userMap[uid || '']?.fullName || '',
        availableDays: dayDetails.map(d => d.day),
        dayDetails,
      };
    }).filter(u => u.userName);

    const notSubmitted = notSubmittedIds.map(id => ({
      userId: id,
      userName: userMap[id]?.fullName || '',
    })).filter(u => u.userName);

    const total = submitted.length + notSubmitted.length;
    const totalAvailableDays = submitted.reduce((s, u) => s + u.availableDays.length, 0);
    const coverageEstimate = total > 0
      ? Math.round((totalAvailableDays / (total * 7)) * 100)
      : 0;

    return {
      weekStartDate,
      submitted,
      notSubmitted,
      total,
      coverageEstimate,
    };
  },
});
