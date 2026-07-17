import { z } from 'zod';
import { createEndpoint, JigyasaRegistrations, JigyasaSessionAttendance, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Backfill sessionMatrix field on all Jigyasa Registrations from existing session attendance records',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.object({
    updated: z.number(),
    skipped: z.number(),
  }),
  execute: async ({ context }) => {
    if (context.user.role !== 'Super Guide' && context.user.role !== 'Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides can run this' });
    }

    // Fetch all session attendance records
    let allSessions: { sessionDate?: string; durationSeconds?: number; jigyasaRegistrations?: string[] | string }[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { records, hasMore: hm } = await JigyasaSessionAttendance.findAll({
        offset,
        limit: 2000,
        fields: ['sessionDate', 'durationSeconds', 'jigyasaRegistrations'],
      });
      allSessions = allSessions.concat(records);
      hasMore = hm;
      offset += records.length;
    }

    // Group by registration ID
    const regMap = new Map<string, { sessionDate: string; durationSeconds: number }[]>();
    for (const s of allSessions) {
      const regField = s.jigyasaRegistrations;
      const regId = Array.isArray(regField) ? regField[0] : regField;
      if (!regId || !s.sessionDate) continue;
      if (!regMap.has(regId)) regMap.set(regId, []);
      regMap.get(regId)!.push({ sessionDate: s.sessionDate, durationSeconds: s.durationSeconds || 0 });
    }

    let updated = 0;
    let skipped = 0;

    for (const [regId, sessions] of regMap) {
      const matrix: Record<string, number> = {};
      let totalDurSec = 0;
      for (const sess of sessions) {
        const mins = Math.floor(sess.durationSeconds / 60) + (sess.durationSeconds % 60 > 0 ? 1 : 0);
        matrix[sess.sessionDate] = (matrix[sess.sessionDate] || 0) + mins;
        totalDurSec += sess.durationSeconds;
      }

      const h = Math.floor(totalDurSec / 3600);
      const m = Math.floor((totalDurSec % 3600) / 60);
      const sec = totalDurSec % 60;
      const totalDuration = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

      try {
        await JigyasaRegistrations.update({
          id: regId,
          record: {
            sessionMatrix: JSON.stringify(matrix),
            totalSessions: sessions.length,
            totalDuration,
          } as any,
        });
        updated++;
      } catch {
        skipped++;
      }
    }

    return { updated, skipped };
  },
});
