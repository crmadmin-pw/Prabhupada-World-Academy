import { z } from 'zod';
import { createEndpoint, Trips, ZiteError } from 'zite-integrations-backend-sdk';

function requireTripEditor(user: any) {
  const role = user.role || '';
  const ok = ['Guide', 'Super Guide'].includes(role) || !!user.isTripCoordinator || !!user.isBvsl || !!user.isSadhanaMentor;
  if (!ok) throw new ZiteError({ code: 'FORBIDDEN', message: 'Trip Coordinator or Guide access required' });
}

export default createEndpoint({
  authenticated: true,
  description: 'Update a trip record (Trip Coordinator, Guide, or Super Guide)',
  inputSchema: z.object({
    tripId: z.string(),
    tripName: z.string().optional(),
    tripDate: z.string().optional(),
    destination: z.string().optional(),
    totalAmount: z.number().optional(),
    amountPaid: z.number().optional(),
    paymentStatus: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    requireTripEditor(context.user);

    const update: Record<string, any> = { correctionStatus: 'Approved', proposedTotalAmount: null, proposedAmountPaid: null };
    if (input.tripName !== undefined) update.tripName = input.tripName;
    if (input.tripDate !== undefined) update.tripDate = input.tripDate;
    if (input.destination !== undefined) update.destination = input.destination;
    if (input.totalAmount !== undefined) update.totalAmount = input.totalAmount;
    if (input.amountPaid !== undefined) update.amountPaid = input.amountPaid;
    if (input.paymentStatus !== undefined) update.paymentStatus = input.paymentStatus;
    if (input.notes !== undefined) update.notes = input.notes;

    await Trips.update({ id: input.tripId, record: update as any });
    return { success: true };
  },
});
