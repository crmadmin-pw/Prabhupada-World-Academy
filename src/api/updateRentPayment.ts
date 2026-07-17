import { z } from 'zod';
import { createEndpoint, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

function requireRentEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isFolkLead || !!user.isBvsl || !!user.isSadhanaMentor;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'FOLK Lead or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Update a rent payment record (FOLK Lead, Guide, or Super Guide)',
  inputSchema: z.object({
    paymentId: z.string(),
    month: z.string().optional(),
    amountDue: z.number().optional(),
    amountPaid: z.number().optional(),
    paymentDate: z.string().optional(),
    status: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    requireRentEditor(context.user);

    const update: Record<string, any> = { correctionStatus: 'Approved', proposedAmountDue: null, proposedAmountPaid: null };
    if (input.month !== undefined) update.month = input.month;
    if (input.amountDue !== undefined) update.amountDue = input.amountDue;
    if (input.amountPaid !== undefined) update.amountPaid = input.amountPaid;
    if (input.paymentDate !== undefined) update.paymentDate = input.paymentDate;
    if (input.status !== undefined) update.status = input.status;
    if (input.notes !== undefined) update.notes = input.notes;

    await RentPayments.update({ id: input.paymentId, record: update as any });
    return { success: true };
  },
});
