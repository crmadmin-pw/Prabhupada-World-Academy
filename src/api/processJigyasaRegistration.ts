import { z } from 'zod';
import { createEndpoint, JigyasaRegistrations, JigyasaProcessedFiles, ZiteError } from 'zite-integrations-backend-sdk';

const rowSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  state: z.string().optional(),
  mangoName: z.string().optional(),
  affiliateName: z.string().optional(),
  affiliateEmail: z.string().optional(),
  affiliatePhone: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  city: z.string().optional(),
  occupation: z.string().optional(),
  attendanceMode: z.string().optional(),
});

export default createEndpoint({
  description: 'Process a TagMango registration CSV (parsed rows from frontend)',
  authenticated: true,
  inputSchema: z.object({
    fileName: z.string(),
    rows: z.array(rowSchema),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    created: z.number(),
    updated: z.number(),
    skipped: z.number(),
  }),
  execute: async ({ input, context }) => {
    const role = context.user.role;
    if (role !== 'Super Guide' && role !== 'Guide') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Only Guides and Super Guides can upload registrations' });
    }

    // Check if already processed
    const existing = await JigyasaProcessedFiles.findOne({ filters: { fileName: input.fileName, fileType: 'Registration' } });
    if (existing) throw new ZiteError({ code: 'CONFLICT', message: 'This registration file has already been processed' });

    let created = 0, updated = 0, skipped = 0;

    // Process in chunks of 100 using bulkCreate with upsert on email
    const validRows = input.rows.filter(r => r.email?.trim());
    for (let i = 0; i < validRows.length; i += 100) {
      const chunk = validRows.slice(i, i + 100);
      const records = chunk.map(r => ({
        name: r.name || '',
        email: r.email!.trim().toLowerCase(),
        phone: r.phone || '',
        state: r.state || '',
        mangoName: r.mangoName || '',
        affiliateName: r.affiliateName || '',
        affiliateEmail: r.affiliateEmail || '',
        affiliatePhone: r.affiliatePhone || '',
        age: r.age || '',
        gender: r.gender || '',
        city: r.city || '',
        occupation: r.occupation || '',
        attendanceMode: r.attendanceMode || '',
      }));
      const result = await JigyasaRegistrations.bulkCreate({ records, matchOn: ['email'] });
      created += result.records.length;
    }

    // Record processed file
    await JigyasaProcessedFiles.create({
      record: {
        fileName: input.fileName,
        fileType: 'Registration',
        recordsProcessed: validRows.length,
        processedAt: new Date().toISOString(),
      },
    });

    return { success: true, created: validRows.length, updated, skipped };
  },
});
