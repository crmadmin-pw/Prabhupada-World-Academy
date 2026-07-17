import { z } from 'zod';
import { createEndpoint, RentPayments, Users, ZiteError } from 'zite-integrations-backend-sdk';

function requireRentEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isFolkLead;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'FOLK Lead or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Export all rent payments as structured data for CSV download',
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.object({
    headers: z.array(z.string()),
    rows: z.array(z.array(z.any())),
    filename: z.string(),
  }),
  execute: async ({ input, context }) => {
    requireRentEditor(context.user);

    const filters: any = {};
    if (input.userId) {
      const user = await Users.findOne({ id: input.userId }).catch(() => undefined)
        || await Users.findOne({ filters: { userId: input.userId } }).catch(() => undefined);
      if (user) filters.user = user.id;
    }

    const { records } = await RentPayments.findAll({ filters, limit: 2000 });

    const userIds = [...new Set(records.map(r => {
      const u = (r as any).user;
      return Array.isArray(u) ? u[0] : u;
    }).filter(Boolean))];
    const userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { records: users } = await Users.findAll({ filters: { id: { in: userIds } } as any, fields: ['id', 'userId', 'fullName'], limit: 2000 });
      users.forEach(u => { if (u.id) userMap[u.id] = `${u.userId || u.id} — ${u.fullName || ''}`; });
    }

    const headers = ['User', 'Month', 'Amount Due', 'Amount Paid', 'Balance', 'Payment Date', 'Status', 'Correction Status', 'Notes'];
    const rows = records.map(r => {
      const uid = Array.isArray((r as any).user) ? (r as any).user[0] : (r as any).user;
      const due = ((r as any).amountDue as number) ?? 0;
      const paid = ((r as any).amountPaid as number) ?? 0;
      return [
        userMap[uid] || uid || '',
        (r as any).month || '',
        due, paid,
        Math.max(0, due - paid),
        (r as any).paymentDate || '',
        (r as any).status || '',
        (r as any).correctionStatus || 'Approved',
        (r as any).notes || '',
      ];
    });

    return { headers, rows, filename: `rent-payments-export-${new Date().toISOString().slice(0, 10)}.csv` };
  },
});
