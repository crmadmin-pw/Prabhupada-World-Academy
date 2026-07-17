import { z } from 'zod';
import { createEndpoint, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'User requests a correction on a rent payment record',
  inputSchema: z.object({
    paymentId: z.string(),
    proposedAmountDue: z.number(),
    proposedAmountPaid: z.number(),
    correctionNotes: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const payment = await RentPayments.findOne({ id: input.paymentId, fields: ['id', 'user'] });
    if (!payment) throw new ZiteError({ code: 'NOT_FOUND', message: 'Rent payment not found' });

    const paymentUserId = Array.isArray(payment.user) ? payment.user[0] : payment.user;
    if (paymentUserId !== context.user!.id) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'You can only request corrections for your own rent payments' });
    }

    await RentPayments.update({
      id: input.paymentId,
      record: {
        proposedAmountDue: input.proposedAmountDue,
        proposedAmountPaid: input.proposedAmountPaid,
        correctionStatus: 'Pending',
        correctionNotes: input.correctionNotes,
      } as any,
    });
    return { success: true };
  },
});
