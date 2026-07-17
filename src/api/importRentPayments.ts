import { z } from 'zod';
import { createEndpoint, Users, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

function requireRentEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isFolkLead;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'FOLK Lead or Guide access required' });
}

const rentRowSchema = z.object({
  userId: z.string(),
  month: z.string(),
  amountDue: z.number().optional(),
  amountPaid: z.number().optional(),
  paymentDate: z.string().optional(),
  status: z.string().optional(),
  notes: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Bulk import rent payment records from CSV data',
  inputSchema: z.object({ records: z.array(rentRowSchema).max(500) }),
  outputSchema: z.object({ success: z.boolean(), imported: z.number(), failed: z.number(), errors: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    requireRentEditor(context.user);

    const errors: string[] = [];
    const toCreate: any[] = [];

    const uniqueUserIds = Array.from(new Set<string>(input.records.map(r => r.userId)));
    const userMap: Record<string, string> = {};
    for (const uid of uniqueUserIds) {
      const user = await Users.findOne({ id: uid, fields: ['id'] }).catch(() => undefined)
        || await Users.findOne({ filters: { userId: uid }, fields: ['id'] }).catch(() => undefined);
      if (user) userMap[uid] = user.id;
      else errors.push(`User not found: ${uid}`);
    }

    for (const r of input.records) {
      const dbUserId = userMap[r.userId];
      if (!dbUserId) continue;
      toCreate.push({
        month: r.month,
        user: dbUserId,
        amountDue: r.amountDue ?? 0,
        amountPaid: r.amountPaid ?? 0,
        paymentDate: r.paymentDate,
        status: r.status || 'Unpaid',
        correctionStatus: 'Approved',
        notes: r.notes,
      });
    }

    if (toCreate.length === 0) return { success: false, imported: 0, failed: input.records.length, errors };

    let imported = 0;
    for (let i = 0; i < toCreate.length; i += 100) {
      const chunk = toCreate.slice(i, i + 100);
      await RentPayments.bulkCreate({ records: chunk as any });
      imported += chunk.length;
    }

    return { success: true, imported, failed: errors.length, errors };
  },
});
