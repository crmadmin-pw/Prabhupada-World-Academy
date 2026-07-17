import { z } from 'zod';
import { createEndpoint, RentPayments, ZiteError } from 'zite-integrations-backend-sdk';

function requireRentEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isFolkLead;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'FOLK Lead or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Approve or reject a pending rent payment correction request',
  inputSchema: z.object({
    paymentId: z.string(),
    action: z.enum(['approve', 'reject']),
    reviewNote: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    requireRentEditor(context.user);

    const payment = await RentPayments.findOne({ id: input.paymentId });
    if (!payment) throw new ZiteError({ code: 'NOT_FOUND', message: 'Rent payment not found' });

    if ((payment as any).correctionStatus !== 'Pending') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No pending correction on this payment' });
    }

    if (input.action === 'approve') {
      await RentPayments.update({
        id: input.paymentId,
        record: {
          amountDue: (payment as any).proposedAmountDue ?? (payment as any).amountDue,
          amountPaid: (payment as any).proposedAmountPaid ?? (payment as any).amountPaid,
          correctionStatus: 'Approved',
          correctionNotes: null,
          proposedAmountDue: null,
          proposedAmountPaid: null,
        } as any,
      });
    } else {
      await RentPayments.update({
        id: input.paymentId,
        record: {
          correctionStatus: 'Rejected',
          correctionNotes: input.reviewNote || ((payment as any).correctionNotes as string) || null,
          proposedAmountDue: null,
          proposedAmountPaid: null,
        } as any,
      });
    }
    return { success: true };
  },
});
