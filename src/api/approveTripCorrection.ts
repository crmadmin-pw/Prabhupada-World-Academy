import { z } from 'zod';
import { createEndpoint, Trips, ZiteError } from 'zite-integrations-backend-sdk';

function requireTripEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isTripCoordinator;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'Trip Coordinator or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Approve or reject a pending trip correction request',
  inputSchema: z.object({
    tripId: z.string(),
    action: z.enum(['approve', 'reject']),
    reviewNote: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    requireTripEditor(context.user);

    const trip = await Trips.findOne({ id: input.tripId });
    if (!trip) throw new ZiteError({ code: 'NOT_FOUND', message: 'Trip not found' });

    if ((trip as any).correctionStatus !== 'Pending') {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No pending correction on this trip' });
    }

    if (input.action === 'approve') {
      await Trips.update({
        id: input.tripId,
        record: {
          totalAmount: (trip as any).proposedTotalAmount ?? (trip as any).totalAmount,
          amountPaid: (trip as any).proposedAmountPaid ?? (trip as any).amountPaid,
          correctionStatus: 'Approved',
          correctionNotes: null,
          proposedTotalAmount: null,
          proposedAmountPaid: null,
        } as any,
      });
    } else {
      await Trips.update({
        id: input.tripId,
        record: {
          correctionStatus: 'Rejected',
          correctionNotes: input.reviewNote || ((trip as any).correctionNotes as string) || null,
          proposedTotalAmount: null,
          proposedAmountPaid: null,
        } as any,
      });
    }
    return { success: true };
  },
});
