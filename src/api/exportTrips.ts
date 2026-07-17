import { z } from 'zod';
import { createEndpoint, Trips, Users, ZiteError } from 'zite-integrations-backend-sdk';

function requireTripEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isTripCoordinator;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'Trip Coordinator or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Export all trips as structured data for CSV download',
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.any())),
    filename: z.string(),
  }),
  execute: async ({ input, context }) => {
    requireTripEditor(context.user);

    const filters: any = {};
    if (input.userId) {
      const user = await Users.findOne({ id: input.userId }).catch(() => undefined)
        || await Users.findOne({ filters: { userId: input.userId } }).catch(() => undefined);
      if (user) filters.user = user.id;
    }

    const { records } = await Trips.findAll({ filters, limit: 2000 });

    // Batch-fetch users
    const userIds = [...new Set(records.map(t => {
      const u = (t as any).user;
      return Array.isArray(u) ? u[0] : u;
    }).filter(Boolean))];
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { records: users } = await Users.findAll({ filters: { id: { in: userIds } } as any, fields: ['id', 'userId', 'fullName'], limit: 2000 });
      users.forEach(u => { if (u.id) userMap[u.id] = `${u.userId || u.id} — ${u.fullName || ''}`; });
    }

    const headers = ['User', 'Trip Name', 'Date', 'Destination', 'Total Amount', 'Amount Paid', 'Balance', 'Payment Status', 'Correction Status', 'Notes'];
    const rows = records.map(t => {
      const uid = Array.isArray((t as any).user) ? (t as any).user[0] : (t as any).user;
      const total = ((t as any).totalAmount as number) ?? 0;
      const paid = ((t as any).amountPaid as number) ?? 0;
      return [
        userMap[uid] || uid || '',
        (t as any).tripName || '',
        (t as any).tripDate || '',
        (t as any).destination || '',
        total,
        paid,
        Math.max(0, total - paid),
        (t as any).paymentStatus || '',
        (t as any).correctionStatus || 'Approved',
        (t as any).notes || '',
      ];
    });

    return { headers, rows, filename: `trips-export-${new Date().toISOString().slice(0, 10)}.csv` };
  },
});
