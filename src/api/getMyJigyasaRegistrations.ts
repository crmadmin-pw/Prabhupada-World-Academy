import { z } from 'zod';
import { createEndpoint, JigyasaRegistrations, JigyasaSessionAttendance } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get Jigyasa registrations for the logged-in affiliate volunteer',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    const email = context.user.email;
    if (!email) return { registrations: [], hasRegistrations: false };

    const { records } = await JigyasaRegistrations.findAll({
      filters: { affiliateEmail: email },
      limit: 500,
    });

    if (records.length === 0) return { registrations: [], hasRegistrations: false };

    // Gather all attendance record IDs
    const regIds = records.map(r => r.id);

    // Fetch all attendance records linked to these registrations
    const attendanceMap = new Map<string, { sessionDate: string; durationSeconds: number; durationDisplay: string }[]>();

    let offset = 0;
    while (true) {
      const { records: attRecords, hasMore } = await JigyasaSessionAttendance.findAll({
        filters: { jigyasaRegistrations: { in: regIds } } as any,
        limit: 2000,
        offset,
      });

      for (const att of attRecords) {
        const regId = Array.isArray(att.jigyasaRegistrations)
          ? att.jigyasaRegistrations[0]
          : att.jigyasaRegistrations;
        if (!regId) continue;
        if (!attendanceMap.has(regId)) attendanceMap.set(regId, []);
        attendanceMap.get(regId)!.push({
          sessionDate: att.sessionDate || '',
          durationSeconds: att.durationSeconds || 0,
          durationDisplay: att.durationDisplay || '',
        });
      }

      if (!hasMore) break;
      offset += 2000;
    }

    const registrations = records.map(r => {
      const sessions = attendanceMap.get(r.id) || [];
      const totalDurationSec = sessions.reduce((s, a) => s + a.durationSeconds, 0);
      return {
        id: r.id,
        name: r.name || 'Unknown',
        email: r.email,
        phone: r.phone,
        city: r.city,
        state: r.state,
        totalSessions: sessions.length,
        totalDurationSeconds: totalDurationSec,
        totalDuration: r.totalDuration || formatDuration(totalDurationSec),
        sessions: sessions.sort((a, b) => (b.sessionDate || '').localeCompare(a.sessionDate || '')),
      };
    });

    const attendedAtLeast1 = registrations.filter(r => r.totalSessions > 0).length;
    const avgSessions = registrations.length > 0
      ? Math.round((registrations.reduce((s, r) => s + r.totalSessions, 0) / registrations.length) * 10) / 10
      : 0;

    return {
      registrations,
      hasRegistrations: true,
      stats: {
        total: registrations.length,
        attendedAtLeast1,
        avgSessions,
      },
    };
  },
});

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
