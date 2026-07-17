import { z } from 'zod';
import { createEndpoint, JigyasaRegistrations, JigyasaSessionAttendance, JigyasaProcessedFiles, ZiteError } from 'zite-integrations-backend-sdk';

const rowSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  durationSeconds: z.number().optional(),
  durationDisplay: z.string().optional(),
});

export default createEndpoint({
  description: 'Process a Jigyasa attendance CSV (parsed rows from frontend)',
  authenticated: true,
  inputSchema: z.object({
    fileName: z.string(),
    sessionDate: z.string(),
    rows: z.array(rowSchema),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    attendeesProcessed: z.number(),
    newRegistrations: z.number(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role;
    if (role !== 'Super Guide' && role !== 'Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can upload attendance' });
    }

    // Check if already processed
    const existing = await JigyasaProcessedFiles.findOne({
      filters: { fileName: input.fileName, fileType: 'Attendance' },
    });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'This attendance file has already been processed' });

    const validRows = input.rows.filter(r => r.email?.trim());
    let newRegistrations = 0;

    // Look up existing registrations by email
    const emailSet = new Set<string>(validRows.map(r => r.email!.trim().toLowerCase()));
    const existingRegs: Record<string, string> = {}; // email -> id

    // Fetch all registrations to match emails
    const { records: allRegs } = await JigyasaRegistrations.findAll({
      limit: 2000,
      fields: ['email'],
    });
    for (const r of allRegs) {
      if (r.email) existingRegs[r.email.toLowerCase()] = r.id;
    }

    // Create missing registrations
    const missingEmails = [...emailSet].filter(e => !existingRegs[e]);
    if (missingEmails.length > 0) {
      const rowsByEmail: Record<string, typeof validRows[0]> = {};
      for (const r of validRows) {
        const e = r.email!.trim().toLowerCase();
        if (!rowsByEmail[e]) rowsByEmail[e] = r;
      }

      for (let i = 0; i < missingEmails.length; i += 100) {
        const chunk = missingEmails.slice(i, i + 100);
        const records = chunk.map(e => ({
          email: e,
          name: rowsByEmail[e]?.name || '',
        }));
        const result = await JigyasaRegistrations.bulkCreate({ records });
        for (const rec of result.records) {
          const email = (rec.fields as any).email?.toLowerCase();
          if (email) existingRegs[email] = rec.id;
        }
        newRegistrations += result.records.length;
      }
    }

    // Create attendance records
    const attendanceRecords = validRows.map(r => {
      const email = r.email!.trim().toLowerCase();
      const regId = existingRegs[email];
      return {
        recordKey: `${email}_${input.sessionDate}`,
        sessionDate: input.sessionDate,
        registration: regId || undefined,
        durationSeconds: r.durationSeconds || 0,
        durationDisplay: r.durationDisplay || '00:00:00',
      };
    }).filter(r => r.registration);

    for (let i = 0; i < attendanceRecords.length; i += 100) {
      const chunk = attendanceRecords.slice(i, i + 100);
      await JigyasaSessionAttendance.bulkCreate({ records: chunk, matchOn: ['recordKey'] });
    }

    // Update totalSessions, totalDuration, and sessionMatrix on registrations
    const regIdsToUpdate = [...new Set<string>(attendanceRecords.map(r => r.registration!))];
    for (const regId of regIdsToUpdate) {
      const { records: sessions } = await JigyasaSessionAttendance.findAll({
        filters: { jigyasaRegistrations: regId },
        limit: 2000,
        fields: ['durationSeconds', 'sessionDate'],
      });
      const totalSessions = sessions.length;
      const totalDurationSec = sessions.reduce((s, sess) => s + (sess.durationSeconds || 0), 0);
      const h = Math.floor(totalDurationSec / 3600);
      const m = Math.floor((totalDurationSec % 3600) / 60);
      const sec = totalDurationSec % 60;
      const totalDuration = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

      // Build session matrix: { "YYYY-MM-DD": minutes, ... }
      const matrix: Record<string, number> = {};
      for (const sess of sessions) {
        if (sess.sessionDate) {
          const durSec = sess.durationSeconds || 0;
          const mins = Math.floor(durSec / 60) + (durSec % 60 > 0 ? 1 : 0);
          matrix[sess.sessionDate] = (matrix[sess.sessionDate] || 0) + mins;
        }
      }

      await JigyasaRegistrations.update({
        id: regId,
        record: { totalSessions, totalDuration, sessionMatrix: JSON.stringify(matrix) } as any,
      });
    }

    // Record processed file
    await JigyasaProcessedFiles.create({
      record: {
        fileName: input.fileName,
        fileType: 'Attendance',
        sessionDate: input.sessionDate,
        recordsProcessed: attendanceRecords.length,
        processedAt: new Date().toISOString(),
      },
    });

    return { success: true, attendeesProcessed: attendanceRecords.length, newRegistrations };
  },
});
