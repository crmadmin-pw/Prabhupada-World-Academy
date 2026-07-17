import { z } from 'zod';
import { createEndpoint, Users, Trips, ZiteError } from 'zite-integrations-backend-sdk';

function requireTripEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isTripCoordinator;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'Trip Coordinator or Guide access required' });
}

const tripRowSchema = z.object({
  userId: z.string(),
  tripName: z.string(),
  tripDate: z.string().optional(),
  destination: z.string().optional(),
  totalAmount: z.number().optional(),
  amountPaid: z.number().optional(),
  paymentStatus: z.string().optional(),
  notes: z.string().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Bulk import trip records from CSV data',
  inputSchema: z.object({ records: z.array(tripRowSchema).max(500) }),
  outputSchema: z.object({ success: z.boolean(), imported: z.number(), failed: z.number(), errors: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    requireTripEditor(context.user);

    const errors: string[] = [];
    const toCreate: any[] = [];

    // Resolve all unique user IDs up front
    const uniqueUserIds = Array.from(new Set<string>(input.records.map(r => r.userId)));
    const userMap: Record<string, string> = {};
    for (const uid of uniqueUserIds) {
      const user = await Users.findOne({ id: uid, fields: ['id'] }).catch(() => undefined)
        || await Users.findOne({ filters: { userId: uid }, fields: ['id'] }).catch(() => undefined);
      if (user) userMap[uid] = user.id;
      else errors.push(`User not found: ${uid}`);
    }

    for (let i = 0; i < input.records.length; i++) {
      const r = input.records[i];
      const dbUserId = userMap[r.userId];
      if (!dbUserId) continue;
      toCreate.push({
        tripName: r.tripName,
        user: dbUserId,
        tripDate: r.tripDate,
        destination: r.destination,
        totalAmount: r.totalAmount ?? 0,
        amountPaid: r.amountPaid ?? 0,
        paymentStatus: r.paymentStatus || 'Unpaid',
        correctionStatus: 'Approved',
        notes: r.notes,
      });
    }

    if (toCreate.length === 0) return { success: false, imported: 0, failed: input.records.length, errors };

    // Bulk create in chunks of 100
    let imported = 0;
    for (let i = 0; i < toCreate.length; i += 100) {
      const chunk = toCreate.slice(i, i + 100);
      await Trips.bulkCreate({ records: chunk as any });
      imported += chunk.length;
    }

    return { success: true, imported, failed: errors.length, errors };
  },
});
