import { z } from 'zod';
import { createEndpoint, Users, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

function requireRentEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isFolkLead || !!user.isBvsl || !!user.isSadhanaMentor;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'FOLK Lead or Guide access required' });
}

async function resolveUser(id: string) {
  const byDbId = await Users.findOne({ id, fields: ['id'] }).catch(() => undefined);
  if (byDbId) return byDbId;
  return Users.findOne({ filters: { userId: id }, fields: ['id'] });
}

export default createEndpoint({
  authenticated: true,
  description: 'Add a rent payment record for a user (FOLK Lead, Guide, or Super Guide)',
  inputSchema: z.object({
    userId: z.string(),
    month: z.string(),
    amountDue: z.number().optional(),
    amountPaid: z.number().optional(),
    paymentDate: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    requireRentEditor(context.user);
    const userRecord = await resolveUser(input.userId);
    if (!userRecord) throw new ZiteError({ code: 'NOT_FOUND', message: 'User not found' });

    const record = await RentPayments.create({
      record: {
        month: input.month,
        user: userRecord.id,
        amountDue: input.amountDue ?? 0,
        amountPaid: input.amountPaid ?? 0,
        paymentDate: input.paymentDate,
        status: input.status || 'Unpaid',
        correctionStatus: 'Approved',
        notes: input.notes,
      } as any,
    });
    return { success: true, id: record.id };
  },
});
